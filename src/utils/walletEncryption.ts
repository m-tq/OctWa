import { Wallet } from '../types/wallet';
import { encryptWalletData } from './password';
import { ExtensionStorageManager } from './extensionStorage';

export class WalletEncryptionManager {
  /**
   * Encrypt all wallets with the given password and store them
   */
  static async encryptAllWallets(wallets: Wallet[], password: string): Promise<void> {
    console.log(`🔐 WalletEncryptionManager: Encrypting ${wallets.length} wallets...`);
    
    const encryptedWallets = [];
    
    for (const wallet of wallets) {
      try {
        const walletData = JSON.stringify(wallet);
        const encryptedWalletData = await encryptWalletData(walletData, password);
        
        encryptedWallets.push({
          address: wallet.address,
          encryptedData: encryptedWalletData,
          createdAt: Date.now()
        });
        
        console.log(`✅ WalletEncryptionManager: Encrypted wallet ${wallet.address.slice(0, 8)}...`);
      } catch (error) {
        console.error(`❌ WalletEncryptionManager: Failed to encrypt wallet ${wallet.address}:`, error);
        throw error;
      }
    }
    
    // Store encrypted wallets
    await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(encryptedWallets));
    console.log(`📦 WalletEncryptionManager: Stored ${encryptedWallets.length} encrypted wallets`);
  }

  /**
   * Add a new wallet to encrypted storage (requires password)
   */
  static async addWalletToEncryptedStorage(wallet: Wallet, password: string): Promise<void> {
    console.log(`🔐 WalletEncryptionManager: Adding wallet ${wallet.address.slice(0, 8)}... to encrypted storage`);
    
    // Get existing encrypted wallets
    const existingEncryptedWallets = JSON.parse(await ExtensionStorageManager.get('encryptedWallets') || '[]');
    
    // Check if wallet already exists
    const walletExists = existingEncryptedWallets.some((w: any) => w.address === wallet.address);
    if (walletExists) {
      console.log(`ℹ️ WalletEncryptionManager: Wallet ${wallet.address.slice(0, 8)}... already exists in encrypted storage`);
      return;
    }
    
    // Encrypt the new wallet
    const walletData = JSON.stringify(wallet);
    const encryptedWalletData = await encryptWalletData(walletData, password);
    
    const newEncryptedWallet = {
      address: wallet.address,
      encryptedData: encryptedWalletData,
      createdAt: Date.now()
    };
    
    // Add to existing encrypted wallets
    const updatedEncryptedWallets = [...existingEncryptedWallets, newEncryptedWallet];
    
    // Store updated encrypted wallets
    await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(updatedEncryptedWallets));
    console.log(`✅ WalletEncryptionManager: Added wallet to encrypted storage. Total: ${updatedEncryptedWallets.length}`);
  }

  /**
   * Check if password protection is enabled
   */
  static async isPasswordProtectionEnabled(): Promise<boolean> {
    const hasPassword = await ExtensionStorageManager.get('walletPasswordHash');
    return !!hasPassword;
  }

  /**
   * Get the count of encrypted wallets
   */
  static async getEncryptedWalletCount(): Promise<number> {
    const encryptedWallets = JSON.parse(await ExtensionStorageManager.get('encryptedWallets') || '[]');
    return encryptedWallets.length;
  }

  /**
   * Verify that all wallets are properly encrypted
   */
  static async verifyAllWalletsEncrypted(wallets: Wallet[]): Promise<boolean> {
    if (!(await this.isPasswordProtectionEnabled())) {
      return true; // No password protection, so encryption not required
    }

    const encryptedWallets = JSON.parse(await ExtensionStorageManager.get('encryptedWallets') || '[]');
    const encryptedAddresses = encryptedWallets.map((w: any) => w.address);
    
    for (const wallet of wallets) {
      if (!encryptedAddresses.includes(wallet.address)) {
        console.warn(`⚠️ WalletEncryptionManager: Wallet ${wallet.address.slice(0, 8)}... is not encrypted`);
        return false;
      }
    }
    
    console.log(`✅ WalletEncryptionManager: All ${wallets.length} wallets are properly encrypted`);
    return true;
  }
}