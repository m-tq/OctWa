// Address Book Manager - Local, Offline, Private, User-controlled
// Syncs between expanded and popup mode via localStorage and chrome.storage

import { AddressBookData, Contact, WalletLabel, DEFAULT_ADDRESS_BOOK, ContactTag } from '../types/addressBook';
import { ExtensionStorageManager } from './extensionStorage';

const STORAGE_KEY = 'octraAddressBook';

class AddressBookManager {
  private data: AddressBookData = DEFAULT_ADDRESS_BOOK;
  private initialized = false;
  private listeners: Set<() => void> = new Set();

  async init(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Try to load from localStorage first (faster)
      const localData = localStorage.getItem(STORAGE_KEY);
      if (localData) {
        this.data = JSON.parse(localData);
      }
      
      // Also try chrome.storage for sync across contexts
      const extData = await ExtensionStorageManager.get(STORAGE_KEY);
      if (extData) {
        const parsed = typeof extData === 'string' ? JSON.parse(extData) : extData;
        // Use the most recent data
        if (parsed.lastUpdated > this.data.lastUpdated) {
          this.data = parsed;
          // Sync back to localStorage
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        }
      }
      
      this.initialized = true;
      this.setupStorageListener();
    } catch (error) {
      console.error('Failed to initialize AddressBook:', error);
      this.data = DEFAULT_ADDRESS_BOOK;
      this.initialized = true;
    }
  }

  private setupStorageListener(): void {
    // Listen for localStorage changes (cross-tab sync)
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const newData = JSON.parse(e.newValue);
          if (newData.lastUpdated > this.data.lastUpdated) {
            this.data = newData;
            this.notifyListeners();
          }
        } catch (error) {
          console.error('Failed to parse storage update:', error);
        }
      }
    });

    // Listen for chrome.storage changes
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE_KEY]) {
          try {
            const newValue = changes[STORAGE_KEY].newValue;
            const newData = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
            if (newData && newData.lastUpdated > this.data.lastUpdated) {
              this.data = newData;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
              this.notifyListeners();
            }
          } catch (error) {
            console.error('Failed to parse chrome.storage update:', error);
          }
        }
      });
    }
  }

  private async save(): Promise<void> {
    this.data.lastUpdated = Date.now();
    const dataStr = JSON.stringify(this.data);
    
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, dataStr);
    
    // Save to chrome.storage for cross-context sync
    try {
      await ExtensionStorageManager.set(STORAGE_KEY, dataStr);
    } catch (error) {
      console.error('Failed to save to ExtensionStorage:', error);
    }
    
    this.notifyListeners();
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  // ============ CONTACTS ============

  getContacts(): Contact[] {
    return [...this.data.contacts];
  }

  getContactByAddress(address: string): Contact | undefined {
    return this.data.contacts.find(c => c.address.toLowerCase() === address.toLowerCase());
  }

  async addContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    const newContact: Contact = {
      ...contact,
      id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Check for duplicate address
    const existing = this.getContactByAddress(contact.address);
    if (existing) {
      throw new Error('Contact with this address already exists');
    }
    
    this.data.contacts.push(newContact);
    await this.save();
    return newContact;
  }

  async updateContact(id: string, updates: Partial<Omit<Contact, 'id' | 'createdAt'>>): Promise<Contact | null> {
    const index = this.data.contacts.findIndex(c => c.id === id);
    if (index === -1) return null;
    
    this.data.contacts[index] = {
      ...this.data.contacts[index],
      ...updates,
      updatedAt: Date.now(),
    };
    
    await this.save();
    return this.data.contacts[index];
  }

  async deleteContact(id: string): Promise<boolean> {
    const index = this.data.contacts.findIndex(c => c.id === id);
    if (index === -1) return false;
    
    this.data.contacts.splice(index, 1);
    await this.save();
    return true;
  }

  // Search contacts by label or address
  searchContacts(query: string): Contact[] {
    const q = query.toLowerCase();
    return this.data.contacts.filter(c => 
      c.label.toLowerCase().includes(q) || 
      c.address.toLowerCase().includes(q) ||
      c.note?.toLowerCase().includes(q)
    );
  }

  // Get contacts by tag
  getContactsByTag(tag: ContactTag): Contact[] {
    return this.data.contacts.filter(c => c.tags.includes(tag));
  }

  // ============ WALLET LABELS ============

  getWalletLabels(): WalletLabel[] {
    return [...this.data.walletLabels];
  }

  getWalletLabel(address: string): WalletLabel | undefined {
    return this.data.walletLabels.find(w => w.address.toLowerCase() === address.toLowerCase());
  }

  async setWalletLabel(address: string, name: string, emoji?: string): Promise<WalletLabel> {
    const existing = this.data.walletLabels.findIndex(
      w => w.address.toLowerCase() === address.toLowerCase()
    );
    
    const label: WalletLabel = {
      address,
      name,
      emoji,
      updatedAt: Date.now(),
    };
    
    if (existing >= 0) {
      this.data.walletLabels[existing] = label;
    } else {
      this.data.walletLabels.push(label);
    }
    
    await this.save();
    return label;
  }

  async removeWalletLabel(address: string): Promise<boolean> {
    const index = this.data.walletLabels.findIndex(
      w => w.address.toLowerCase() === address.toLowerCase()
    );
    if (index === -1) return false;
    
    this.data.walletLabels.splice(index, 1);
    await this.save();
    return true;
  }

  // ============ AUTO-MIGRATION ============

  // Auto-add labels for existing wallets that don't have labels
  // Also reorder wallet labels to match the wallet order
  async autoLabelWallets(wallets: { address: string; type?: string }[]): Promise<void> {
    let hasChanges = false;
    const newWalletLabels: WalletLabel[] = [];
    
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const existing = this.getWalletLabel(wallet.address);
      
      if (existing) {
        // Keep existing label but add to new ordered list
        newWalletLabels.push(existing);
      } else {
        // Simple default label: Wallet 1, Wallet 2, etc.
        const defaultName = `Wallet ${i + 1}`;
        
        newWalletLabels.push({
          address: wallet.address,
          name: defaultName,
          updatedAt: Date.now(),
        });
        hasChanges = true;
      }
    }
    
    // Check if order changed
    const orderChanged = this.data.walletLabels.length !== newWalletLabels.length ||
      this.data.walletLabels.some((label, index) => 
        newWalletLabels[index]?.address.toLowerCase() !== label.address.toLowerCase()
      );
    
    if (hasChanges || orderChanged) {
      this.data.walletLabels = newWalletLabels;
      await this.save();
    }
  }

  // Get display name for wallet (label or truncated address)
  getWalletDisplayName(address: string): string {
    const label = this.getWalletLabel(address);
    if (label) {
      return label.name;
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  // Export data for backup
  exportData(): string {
    return JSON.stringify(this.data, null, 2);
  }

  // Import data from backup
  async importData(jsonStr: string): Promise<void> {
    try {
      const imported = JSON.parse(jsonStr) as AddressBookData;
      if (!imported.version || !Array.isArray(imported.contacts)) {
        throw new Error('Invalid address book format');
      }
      this.data = imported;
      await this.save();
    } catch (error) {
      throw new Error('Failed to import address book: ' + (error as Error).message);
    }
  }

  // Clear all data (for reset)
  async clearAll(): Promise<void> {
    this.data = { ...DEFAULT_ADDRESS_BOOK, lastUpdated: Date.now() };
    
    // Clear from localStorage
    localStorage.removeItem(STORAGE_KEY);
    
    // Clear from chrome.storage
    try {
      await ExtensionStorageManager.remove(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear from ExtensionStorage:', error);
    }
    
    this.notifyListeners();
  }
}

// Singleton instance
export const addressBook = new AddressBookManager();
