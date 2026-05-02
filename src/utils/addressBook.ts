// Address Book Manager — local, offline, private, user-controlled.
// Syncs between expanded and popup via localStorage and chrome.storage.

import { AddressBookData, Contact, WalletLabel, DEFAULT_ADDRESS_BOOK, ContactTag } from '../types/addressBook';
import { ExtensionStorageManager } from './extensionStorage';

const STORAGE_KEY = 'octraAddressBook';

class AddressBookManager {
  private data: AddressBookData = DEFAULT_ADDRESS_BOOK;
  private initialized = false;
  private readonly listeners = new Set<() => void>();

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const localData = localStorage.getItem(STORAGE_KEY);
      if (localData) this.data = JSON.parse(localData);

      const extData = await ExtensionStorageManager.get(STORAGE_KEY);
      if (extData) {
        const parsed = typeof extData === 'string' ? JSON.parse(extData) : extData;
        if (parsed.lastUpdated > this.data.lastUpdated) {
          this.data = parsed;
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
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const newData = JSON.parse(e.newValue);
        if (newData.lastUpdated > this.data.lastUpdated) {
          this.data = newData;
          this.notifyListeners();
        }
      } catch (error) {
        console.error('Failed to parse storage update:', error);
      }
    });

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
        try {
          const newValue = changes[STORAGE_KEY].newValue;
          const newData = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
          if (newData?.lastUpdated > this.data.lastUpdated) {
            this.data = newData;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
            this.notifyListeners();
          }
        } catch (error) {
          console.error('Failed to parse chrome.storage update:', error);
        }
      });
    }
  }

  private async save(): Promise<void> {
    this.data.lastUpdated = Date.now();
    const dataStr = JSON.stringify(this.data);
    localStorage.setItem(STORAGE_KEY, dataStr);
    try {
      await ExtensionStorageManager.set(STORAGE_KEY, dataStr);
    } catch (error) {
      console.error('Failed to save to ExtensionStorage:', error);
    }
    this.notifyListeners();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  getContacts(): Contact[] {
    return [...this.data.contacts];
  }

  getContactByAddress(address: string): Contact | undefined {
    return this.data.contacts.find(
      (c) => c.address.toLowerCase() === address.toLowerCase(),
    );
  }

  async addContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    if (this.getContactByAddress(contact.address)) {
      throw new Error('Contact with this address already exists');
    }

    const newContact: Contact = {
      ...contact,
      id: `contact_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.data.contacts.push(newContact);
    await this.save();
    return newContact;
  }

  async updateContact(
    id: string,
    updates: Partial<Omit<Contact, 'id' | 'createdAt'>>,
  ): Promise<Contact | null> {
    const index = this.data.contacts.findIndex((c) => c.id === id);
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
    const index = this.data.contacts.findIndex((c) => c.id === id);
    if (index === -1) return false;

    this.data.contacts.splice(index, 1);
    await this.save();
    return true;
  }

  searchContacts(query: string): Contact[] {
    const q = query.toLowerCase();
    return this.data.contacts.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.note?.toLowerCase().includes(q),
    );
  }

  getContactsByTag(tag: ContactTag): Contact[] {
    return this.data.contacts.filter((c) => c.tags.includes(tag));
  }

  getWalletLabels(): WalletLabel[] {
    return [...this.data.walletLabels];
  }

  getWalletLabel(address: string): WalletLabel | undefined {
    return this.data.walletLabels.find(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    );
  }

  async setWalletLabel(address: string, name: string, emoji?: string): Promise<WalletLabel> {
    const existingIndex = this.data.walletLabels.findIndex(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    );

    const label: WalletLabel = { address, name, emoji, updatedAt: Date.now() };

    if (existingIndex >= 0) {
      this.data.walletLabels[existingIndex] = label;
    } else {
      this.data.walletLabels.push(label);
    }

    await this.save();
    return label;
  }

  async removeWalletLabel(address: string): Promise<boolean> {
    const index = this.data.walletLabels.findIndex(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    );
    if (index === -1) return false;

    this.data.walletLabels.splice(index, 1);
    await this.save();
    return true;
  }

  async autoLabelWallets(wallets: { address: string; type?: string }[]): Promise<void> {
    let hasChanges = false;
    const newWalletLabels: WalletLabel[] = [];

    for (let i = 0; i < wallets.length; i++) {
      const existing = this.getWalletLabel(wallets[i].address);
      if (existing) {
        newWalletLabels.push(existing);
      } else {
        newWalletLabels.push({
          address: wallets[i].address,
          name: `Wallet ${i + 1}`,
          updatedAt: Date.now(),
        });
        hasChanges = true;
      }
    }

    const orderChanged =
      this.data.walletLabels.length !== newWalletLabels.length ||
      this.data.walletLabels.some(
        (label, index) =>
          newWalletLabels[index]?.address.toLowerCase() !== label.address.toLowerCase(),
      );

    if (hasChanges || orderChanged) {
      this.data.walletLabels = newWalletLabels;
      await this.save();
    }
  }

  getWalletDisplayName(address: string): string {
    const label = this.getWalletLabel(address);
    return label ? label.name : `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  exportData(): string {
    return JSON.stringify(this.data, null, 2);
  }

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

  async clearAll(): Promise<void> {
    this.data = { ...DEFAULT_ADDRESS_BOOK, lastUpdated: Date.now() };
    localStorage.removeItem(STORAGE_KEY);
    try {
      await ExtensionStorageManager.remove(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear from ExtensionStorage:', error);
    }
    this.notifyListeners();
  }
}

export const addressBook = new AddressBookManager();
