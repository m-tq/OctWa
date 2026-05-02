import { ExtensionStorageManager } from './extensionStorage';
import {
  verifyPassword,
  decryptWalletData,
  encryptWalletData,
  isRateLimited,
  getRemainingAttempts,
  generateSessionKey,
  encryptSessionData,
  decryptSessionData,
} from './password';
import { Wallet } from '../types/wallet';
import { deriveEvmFromOctraKey } from './evmDerive';

const EVM_ADDRESS_MAP_KEY = 'evmAddressMap';

interface EncryptedWalletEntry {
  address: string;
  encryptedData: string;
  createdAt: number;
  needsEncryption?: boolean;
}

export class WalletManager {
  private static sessionPassword: string | null = null;
  private static sessionEncryptionKey: string | null = null;
  private static sessionTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly SESSION_TIMEOUT_MS = 15 * 60 * 1000;
  private static onAutoLockCallback: (() => void) | null = null;
  private static readonly isAutoLockEnabled = true;
  private static timerStartTime = 0;
  private static readonly SESSION_TIMESTAMP_KEY = 'walletSessionTimestamp';
  private static readonly MIGRATION_VERSION_KEY = 'walletMigrationVersion';
  private static readonly CURRENT_MIGRATION_VERSION = 2;

  static async migrateIfNeeded(): Promise<{ migrated: boolean; message?: string }> {
    try {
      const currentVersion = parseInt(localStorage.getItem(this.MIGRATION_VERSION_KEY) ?? '1', 10);
      if (currentVersion >= this.CURRENT_MIGRATION_VERSION) return { migrated: false };

      const unencryptedWallets = localStorage.getItem('wallets');
      const hasPassword = localStorage.getItem('walletPasswordHash');

      if (unencryptedWallets && hasPassword) {
        const encryptedWallets = localStorage.getItem('encryptedWallets');
        if (encryptedWallets) {
          localStorage.removeItem('wallets');
          await ExtensionStorageManager.remove('wallets');
        } else {
          console.warn('WalletManager: Found unencrypted wallets but no encrypted version');
          return {
            migrated: false,
            message: 'Please unlock your wallet to complete security upgrade. Your wallet data will be re-encrypted.',
          };
        }
      }

      localStorage.setItem(this.MIGRATION_VERSION_KEY, this.CURRENT_MIGRATION_VERSION.toString());
      await ExtensionStorageManager.set(this.MIGRATION_VERSION_KEY, this.CURRENT_MIGRATION_VERSION.toString());
      return { migrated: true };
    } catch (error) {
      console.error('WalletManager: Migration failed:', error);
      return { migrated: false, message: 'Migration failed. Please contact support.' };
    }
  }

  static async storeEvmAddress(octraAddress: string, privateKeyB64: string): Promise<string> {
    try {
      const { evmAddress } = deriveEvmFromOctraKey(privateKeyB64);
      const mapStr = localStorage.getItem(EVM_ADDRESS_MAP_KEY);
      const map: Record<string, string> = mapStr ? JSON.parse(mapStr) : {};
      map[octraAddress] = evmAddress;
      const mapJson = JSON.stringify(map);
      localStorage.setItem(EVM_ADDRESS_MAP_KEY, mapJson);
      await ExtensionStorageManager.set(EVM_ADDRESS_MAP_KEY, mapJson);
      return evmAddress;
    } catch (error) {
      console.error('WalletManager: Failed to store EVM address:', error);
      return '';
    }
  }

  static getEvmAddress(octraAddress: string): string {
    try {
      const mapStr = localStorage.getItem(EVM_ADDRESS_MAP_KEY);
      if (!mapStr) return '';
      const map: Record<string, string> = JSON.parse(mapStr);
      return map[octraAddress] ?? '';
    } catch {
      return '';
    }
  }

  static async storeAllEvmAddresses(wallets: Wallet[]): Promise<void> {
    for (const wallet of wallets) {
      if (wallet.privateKey) {
        await this.storeEvmAddress(wallet.address, wallet.privateKey);
      }
    }
  }

  static async cleanupUnencryptedData(): Promise<void> {
    try {
      localStorage.removeItem('wallets');
      await ExtensionStorageManager.remove('wallets');
    } catch (error) {
      console.error('WalletManager: Failed to cleanup unencrypted data:', error);
    }
  }

  static async securityAudit(): Promise<{ issues: string[]; isSecure: boolean }> {
    const issues: string[] = [];

    try {
      if (localStorage.getItem('wallets')) {
        issues.push('Found unencrypted "wallets" key in localStorage');
        localStorage.removeItem('wallets');
        await ExtensionStorageManager.remove('wallets');
      }

      const encryptedData = localStorage.getItem('encryptedWallets');
      if (encryptedData) {
        try {
          const wallets = JSON.parse(encryptedData);
          if (Array.isArray(wallets)) {
            for (const w of wallets as EncryptedWalletEntry[]) {
              if (w.needsEncryption) {
                issues.push(`Wallet ${w.address?.slice(0, 8)}... has needsEncryption flag`);
              }
              try {
                const parsed = JSON.parse(w.encryptedData) as Record<string, unknown>;
                if (parsed.privateKey || parsed.mnemonic) {
                  issues.push(`Wallet ${w.address?.slice(0, 8)}... has unencrypted sensitive data!`);
                }
              } catch { /* encrypted — good */ }
            }
          }
        } catch (e) {
          console.error('Failed to parse encryptedWallets for audit:', e);
        }
      }

      const sensitiveTerms = ['privateKey', 'mnemonic', 'seed', 'secret'];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && sensitiveTerms.some((t) => key.toLowerCase().includes(t))) {
          issues.push(`Found potentially sensitive key in localStorage: ${key}`);
        }
      }

      if (issues.length > 0) console.warn('Security audit found issues:', issues);
      return { issues, isSecure: issues.length === 0 };
    } catch (error) {
      console.error('Security audit failed:', error);
      return { issues: ['Audit failed: ' + String(error)], isSecure: false };
    }
  }

  static setAutoLockCallback(callback: () => void): void {
    this.onAutoLockCallback = callback;
    if (this.sessionPassword && this.isAutoLockEnabled) {
      this.startAutoLockTimer();
    }
  }

  private static startAutoLockTimer(): void {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    if (!this.isAutoLockEnabled) return;

    this.timerStartTime = Date.now();
    localStorage.setItem(this.SESSION_TIMESTAMP_KEY, this.timerStartTime.toString());

    this.sessionTimeout = setTimeout(() => {
      this.executeAutoLock();
    }, this.SESSION_TIMEOUT_MS);
  }

  private static async executeAutoLock(): Promise<void> {
    try {
      await this.lockWallets();
      this.onAutoLockCallback?.();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'isWalletLocked',
            oldValue: 'false',
            newValue: 'true',
            storageArea: localStorage,
          }),
        );
      }
    } catch (error) {
      console.error('WalletManager: Auto-lock failed:', error);
    }
  }

  static setSessionPassword(password: string): void {
    if (this.sessionPassword) this.clearSessionPassword();

    this.sessionPassword = password;
    this.sessionEncryptionKey = generateSessionKey();

    this.storeSessionPasswordToStorage(password);
    this.storeSessionEncryptionKeyToStorage(this.sessionEncryptionKey);
    this.startAutoLockTimer();
  }

  private static async storeSessionPasswordToStorage(password: string): Promise<void> {
    try {
      const encoded = btoa(unescape(encodeURIComponent(password)));
      await ExtensionStorageManager.setSession('sessionKey', encoded);
    } catch (error) {
      console.error('Failed to store session password:', error);
    }
  }

  private static async storeSessionEncryptionKeyToStorage(key: string): Promise<void> {
    try {
      await ExtensionStorageManager.setSession('sessionEncKey', key);
    } catch (error) {
      console.error('Failed to store session encryption key:', error);
    }
  }

  private static async retrieveSessionPasswordFromStorage(): Promise<string | null> {
    try {
      const encoded = await ExtensionStorageManager.getSession('sessionKey');
      return encoded ? decodeURIComponent(escape(atob(encoded))) : null;
    } catch (error) {
      console.error('Failed to retrieve session password:', error);
      return null;
    }
  }

  private static async retrieveSessionEncryptionKeyFromStorage(): Promise<string | null> {
    try {
      return await ExtensionStorageManager.getSession('sessionEncKey');
    } catch (error) {
      console.error('Failed to retrieve session encryption key:', error);
      return null;
    }
  }

  static async ensureSessionPassword(): Promise<string | null> {
    if (this.sessionPassword && this.sessionEncryptionKey) return this.sessionPassword;

    const [storedPassword, storedEncKey] = await Promise.all([
      this.retrieveSessionPasswordFromStorage(),
      this.retrieveSessionEncryptionKeyFromStorage(),
    ]);

    if (storedPassword && storedEncKey) {
      this.sessionPassword = storedPassword;
      this.sessionEncryptionKey = storedEncKey;
      this.startAutoLockTimer();
      return storedPassword;
    }

    return null;
  }

  static clearSessionPassword(): void {
    this.sessionPassword = null;
    this.sessionEncryptionKey = null;

    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }

    localStorage.removeItem(this.SESSION_TIMESTAMP_KEY);
    this.clearSessionDataFromStorage();
  }

  private static async clearSessionDataFromStorage(): Promise<void> {
    try {
      await Promise.all([
        ExtensionStorageManager.removeSession('sessionKey'),
        ExtensionStorageManager.removeSession('sessionEncKey'),
        ExtensionStorageManager.removeSession('sessionWallets'),
      ]);
    } catch (error) {
      console.error('Failed to clear session data from storage:', error);
    }
  }

  static getSessionPassword(): string | null {
    return this.sessionPassword;
  }

  static refreshSessionTimeout(): void {
    if (this.sessionPassword) this.startAutoLockTimer();
  }

  static isSessionActive(): boolean {
    return this.sessionPassword !== null;
  }

  static isSessionValidAcrossInstances(): boolean {
    const timestampStr = localStorage.getItem(this.SESSION_TIMESTAMP_KEY);
    if (!timestampStr) return false;
    const timestamp = parseInt(timestampStr, 10);
    return !isNaN(timestamp) && Date.now() - timestamp < this.SESSION_TIMEOUT_MS;
  }

  static refreshSessionFromStorage(): boolean {
    if (!this.isSessionValidAcrossInstances()) return false;
    if (this.sessionPassword) {
      this.startAutoLockTimer();
      return true;
    }
    return false;
  }

  static checkRateLimit(): { limited: boolean; remainingMs?: number; remainingAttempts: number } {
    return { ...isRateLimited(), remainingAttempts: getRemainingAttempts() };
  }

  static async unlockWallets(password: string): Promise<Wallet[]> {
    try {
      let hashedPassword = localStorage.getItem('walletPasswordHash');
      let salt = localStorage.getItem('walletPasswordSalt');

      if (!hashedPassword || !salt) {
        hashedPassword = await ExtensionStorageManager.get('walletPasswordHash');
        salt = await ExtensionStorageManager.get('walletPasswordSalt');
        if (hashedPassword && salt) {
          localStorage.setItem('walletPasswordHash', hashedPassword);
          localStorage.setItem('walletPasswordSalt', salt);
        }
      } else {
        const extHash = await ExtensionStorageManager.get('walletPasswordHash');
        if (!extHash || extHash !== hashedPassword) {
          await ExtensionStorageManager.set('walletPasswordHash', hashedPassword);
          await ExtensionStorageManager.set('walletPasswordSalt', salt);
        }
      }

      if (!hashedPassword || !salt) throw new Error('No password set');

      const isValid = await verifyPassword(password, hashedPassword, salt);
      if (!isValid) throw new Error('Invalid password');

      this.setSessionPassword(password);

      let encryptedWallets = localStorage.getItem('encryptedWallets');
      if (!encryptedWallets) {
        encryptedWallets = await ExtensionStorageManager.get('encryptedWallets');
        if (encryptedWallets) {
          localStorage.setItem('encryptedWallets', encryptedWallets);
        }
      } else {
        const extWallets = await ExtensionStorageManager.get('encryptedWallets');
        if (!extWallets) {
          await ExtensionStorageManager.set('encryptedWallets', encryptedWallets);
        }
      }

      const decryptedWallets: Wallet[] = [];

      if (encryptedWallets) {
        try {
          const parsedEncrypted: EncryptedWalletEntry[] =
            typeof encryptedWallets === 'string'
              ? JSON.parse(encryptedWallets)
              : encryptedWallets;

          let walletsWereUpgraded = false;

          for (const encryptedWallet of parsedEncrypted) {
            try {
              let wallet: Wallet;

              if (encryptedWallet.needsEncryption) {
                try {
                  wallet = JSON.parse(encryptedWallet.encryptedData);
                } catch (parseError) {
                  console.error('WalletManager: Failed to parse needsEncryption wallet data:', parseError);
                  continue;
                }
                encryptedWallet.encryptedData = await encryptWalletData(JSON.stringify(wallet), password);
                delete encryptedWallet.needsEncryption;
                walletsWereUpgraded = true;
              } else {
                const decryptedData = await decryptWalletData(encryptedWallet.encryptedData, password);
                wallet = JSON.parse(decryptedData);
              }

              if (!wallet.type) {
                wallet.type = wallet.mnemonic ? 'generated' : 'imported-private-key';
              }

              decryptedWallets.push(wallet);
            } catch (error) {
              console.error('WalletManager: Failed to decrypt wallet:', encryptedWallet.address, error);
            }
          }

          if (walletsWereUpgraded) {
            const upgraded = JSON.stringify(parsedEncrypted);
            await ExtensionStorageManager.set('encryptedWallets', upgraded);
            localStorage.setItem('encryptedWallets', upgraded);
          }
        } catch (error) {
          console.error('WalletManager: Failed to parse encrypted wallets:', error);
          throw new Error('Failed to parse encrypted wallet data');
        }
      }

      await ExtensionStorageManager.set('isWalletLocked', 'false');
      localStorage.setItem('isWalletLocked', 'false');

      if (decryptedWallets.length > 0) {
        localStorage.removeItem('wallets');
        await ExtensionStorageManager.remove('wallets');

        const encryptedWalletsData = await ExtensionStorageManager.get('encryptedWallets');
        if (encryptedWalletsData) {
          const encWallets: EncryptedWalletEntry[] =
            typeof encryptedWalletsData === 'string'
              ? JSON.parse(encryptedWalletsData)
              : encryptedWalletsData;

          if (Array.isArray(encWallets)) {
            const validAddresses = new Set(decryptedWallets.map((w) => w.address));
            const synced = encWallets.filter((w) => validAddresses.has(w.address));
            if (synced.length !== encWallets.length) {
              const syncedJson = JSON.stringify(synced);
              await ExtensionStorageManager.set('encryptedWallets', syncedJson);
              localStorage.setItem('encryptedWallets', syncedJson);
            }
          }
        }

        const activeWalletId = await ExtensionStorageManager.get('activeWalletId');
        if (!activeWalletId || !decryptedWallets.some((w) => w.address === activeWalletId)) {
          await ExtensionStorageManager.set('activeWalletId', decryptedWallets[0].address);
          localStorage.setItem('activeWalletId', decryptedWallets[0].address);
        }

        await this.updateSessionWallets(decryptedWallets);
        await this.storeAllEvmAddresses(decryptedWallets);
      }

      await this.cleanupUnencryptedData();
      await this.securityAudit();

      return decryptedWallets;
    } catch (error) {
      console.error('WalletManager unlock error:', error);
      throw error;
    }
  }

  static async updateSessionWallets(wallets: Wallet[]): Promise<void> {
    if (!this.sessionEncryptionKey) {
      console.warn('WalletManager: No session encryption key, cannot store wallets securely');
      return;
    }
    try {
      const encrypted = await encryptSessionData(JSON.stringify(wallets), this.sessionEncryptionKey);
      await ExtensionStorageManager.setSession('sessionWallets', encrypted);
    } catch (error) {
      console.error('Failed to update session wallets:', error);
    }
  }

  static async getSessionWallets(): Promise<Wallet[]> {
    try {
      const encrypted = await ExtensionStorageManager.getSession('sessionWallets');
      if (!encrypted) return [];

      if (!this.sessionEncryptionKey) {
        console.warn('WalletManager: No session encryption key, cannot decrypt wallets');
        return [];
      }

      try {
        const decryptedJson = await decryptSessionData(encrypted, this.sessionEncryptionKey);
        const parsed = JSON.parse(decryptedJson);
        return Array.isArray(parsed) ? parsed : [];
      } catch (decryptError) {
        console.error('Failed to decrypt session wallets:', decryptError);
        await ExtensionStorageManager.removeSession('sessionWallets');
        return [];
      }
    } catch (error) {
      console.error('Failed to get session wallets:', error);
      return [];
    }
  }

  static async addEncryptedWallet(wallet: Wallet): Promise<void> {
    let password = this.getSessionPassword() ?? await this.ensureSessionPassword();

    if (!password) {
      console.error('SECURITY: Cannot store wallet without encryption password!');
      throw new Error('Session password required to add wallet. Please unlock your wallet first.');
    }

    try {
      const localData = localStorage.getItem('encryptedWallets');
      const extData = await ExtensionStorageManager.get('encryptedWallets');
      const existingData = localData ?? extData;

      const encryptedWallets: EncryptedWalletEntry[] = existingData
        ? JSON.parse(existingData)
        : [];

      const encryptedData = await encryptWalletData(JSON.stringify(wallet), password);
      const entry: EncryptedWalletEntry = {
        address: wallet.address,
        encryptedData,
        createdAt: Date.now(),
      };

      const existingIndex = encryptedWallets.findIndex((w) => w.address === wallet.address);
      if (existingIndex >= 0) {
        encryptedWallets[existingIndex] = entry;
      } else {
        encryptedWallets.push(entry);
      }

      const encryptedJson = JSON.stringify(encryptedWallets);
      await ExtensionStorageManager.set('encryptedWallets', encryptedJson);
      localStorage.setItem('encryptedWallets', encryptedJson);

      await this.storeEvmAddress(wallet.address, wallet.privateKey);
    } catch (error) {
      console.error('Failed to store wallet:', error);
      throw error;
    }
  }

  static async reorderWallets(newOrder: Wallet[]): Promise<void> {
    const password = this.getSessionPassword() ?? await this.ensureSessionPassword();

    if (!password) {
      console.error('SECURITY: Cannot reorder wallets without session password!');
      throw new Error('Session password required to reorder wallets. Please unlock your wallet first.');
    }

    try {
      const existingData = localStorage.getItem('encryptedWallets') ??
        await ExtensionStorageManager.get('encryptedWallets');

      if (!existingData) {
        console.warn('reorderWallets: No encrypted wallets found');
        return;
      }

      const encryptedWallets: EncryptedWalletEntry[] = JSON.parse(existingData);
      const encryptedMap = new Map(encryptedWallets.map((w) => [w.address, w]));
      const reordered = newOrder.map((w) => encryptedMap.get(w.address)).filter(Boolean);

      const encryptedJson = JSON.stringify(reordered);
      await ExtensionStorageManager.set('encryptedWallets', encryptedJson);
      localStorage.setItem('encryptedWallets', encryptedJson);

      await this.updateSessionWallets(newOrder);
    } catch (error) {
      console.error('Failed to reorder wallets:', error);
      throw error;
    }
  }

  static async removeEncryptedWallet(address: string): Promise<void> {
    try {
      const existingData = await ExtensionStorageManager.get('encryptedWallets');
      if (!existingData) return;

      const encryptedWallets: EncryptedWalletEntry[] =
        typeof existingData === 'string' ? JSON.parse(existingData) : existingData;

      const filtered = encryptedWallets.filter((w) => w.address !== address);
      const filteredJson = JSON.stringify(filtered);

      await ExtensionStorageManager.set('encryptedWallets', filteredJson);
      localStorage.setItem('encryptedWallets', filteredJson);

      const currentSessionWallets = await this.getSessionWallets();
      await this.updateSessionWallets(currentSessionWallets.filter((w) => w.address !== address));
    } catch (error) {
      console.error('Failed to remove encrypted wallet:', error);
    }
  }

  static async lockWallets(): Promise<void> {
    try {
      const preservedActiveWalletId =
        (await ExtensionStorageManager.get('activeWalletId')) ??
        localStorage.getItem('activeWalletId');

      this.clearSessionPassword();

      await ExtensionStorageManager.set('isWalletLocked', 'true');
      localStorage.setItem('isWalletLocked', 'true');

      localStorage.removeItem('wallets');
      await ExtensionStorageManager.remove('wallets');
      await ExtensionStorageManager.removeSession('sessionWallets');

      if (preservedActiveWalletId) {
        const activeAfter = await ExtensionStorageManager.get('activeWalletId');
        if (!activeAfter) {
          await ExtensionStorageManager.set('activeWalletId', preservedActiveWalletId);
          localStorage.setItem('activeWalletId', preservedActiveWalletId);
        }
      }
    } catch (error) {
      console.error('WalletManager lock error:', error);
      throw error;
    }
  }

  static async isWalletSetup(): Promise<boolean> {
    try {
      return !!(await ExtensionStorageManager.get('walletPasswordHash'));
    } catch (error) {
      console.error('Failed to check wallet setup:', error);
      return false;
    }
  }

  static async shouldShowUnlockScreen(): Promise<boolean> {
    try {
      const [hasPassword, , encryptedWallets] = await Promise.all([
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('isWalletLocked'),
        ExtensionStorageManager.get('encryptedWallets'),
      ]);

      const localPasswordHash = localStorage.getItem('walletPasswordHash');
      const localEncryptedWallets = localStorage.getItem('encryptedWallets');

      if (!hasPassword && !localPasswordHash) return false;

      const encryptedData = encryptedWallets ?? localEncryptedWallets;
      if (!encryptedData) return false;

      try {
        const parsed = typeof encryptedData === 'string' ? JSON.parse(encryptedData) : encryptedData;
        return Array.isArray(parsed) && parsed.length > 0;
      } catch {
        return false;
      }
    } catch (error) {
      console.error('Failed to check unlock status:', error);
      return false;
    }
  }

  static async isWalletLocked(): Promise<boolean> {
    try {
      const [hasPassword, isLocked] = await Promise.all([
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('isWalletLocked'),
      ]);
      if (!hasPassword) return false;
      return isLocked !== 'false';
    } catch (error) {
      console.error('Failed to check lock status:', error);
      return false;
    }
  }

  static async exportBackup(): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const [encryptedWallets, passwordHash, passwordSalt] = await Promise.all([
        ExtensionStorageManager.get('encryptedWallets'),
        ExtensionStorageManager.get('walletPasswordHash'),
        ExtensionStorageManager.get('walletPasswordSalt'),
      ]);

      if (!encryptedWallets || !passwordHash || !passwordSalt) {
        return { success: false, error: 'No wallet data to export' };
      }

      const backupData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        encryptedWallets: typeof encryptedWallets === 'string'
          ? JSON.parse(encryptedWallets)
          : encryptedWallets,
        passwordHash,
        passwordSalt,
      };

      return { success: true, data: btoa(unescape(encodeURIComponent(JSON.stringify(backupData, null, 2)))) };
    } catch (error) {
      console.error('Failed to export backup:', error);
      return { success: false, error: 'Failed to create backup' };
    }
  }

  static async importBackup(
    backupData: string,
  ): Promise<{ success: boolean; walletsCount?: number; error?: string }> {
    try {
      const jsonString = decodeURIComponent(escape(atob(backupData)));
      const backup = JSON.parse(jsonString);

      if (!backup.version || !backup.encryptedWallets || !backup.passwordHash || !backup.passwordSalt) {
        return { success: false, error: 'Invalid backup format' };
      }

      const existingHash = await ExtensionStorageManager.get('walletPasswordHash');
      if (existingHash) {
        return { success: false, error: 'Wallet already exists. Reset first to import backup.' };
      }

      const walletsJson = JSON.stringify(backup.encryptedWallets);
      await Promise.all([
        ExtensionStorageManager.set('encryptedWallets', walletsJson),
        ExtensionStorageManager.set('walletPasswordHash', backup.passwordHash),
        ExtensionStorageManager.set('walletPasswordSalt', backup.passwordSalt),
        ExtensionStorageManager.set('isWalletLocked', 'true'),
      ]);

      localStorage.setItem('encryptedWallets', walletsJson);
      localStorage.setItem('walletPasswordHash', backup.passwordHash);
      localStorage.setItem('walletPasswordSalt', backup.passwordSalt);
      localStorage.setItem('isWalletLocked', 'true');

      return {
        success: true,
        walletsCount: Array.isArray(backup.encryptedWallets) ? backup.encryptedWallets.length : 0,
      };
    } catch (error) {
      console.error('Failed to import backup:', error);
      return { success: false, error: 'Failed to import backup. Invalid data format.' };
    }
  }

  static async getEvmPrivateKey(octraAddress: string): Promise<string | null> {
    try {
      const wallets = await this.getSessionWallets();
      const wallet = wallets.find((w) => w.address === octraAddress);

      if (!wallet?.privateKey) {
        console.warn('[WalletManager] Wallet not found or no private key:', octraAddress.slice(0, 8));
        return null;
      }

      return deriveEvmFromOctraKey(wallet.privateKey).privateKeyHex;
    } catch (error) {
      console.error('[WalletManager] Failed to get EVM private key:', error);
      return null;
    }
  }
}
