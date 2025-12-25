/**
 * PermissionManager - Manages wallet capabilities for dApps
 * Stores granted capabilities in localStorage/chrome.storage
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import {
  WalletCapability,
  CapabilityRequest,
  GrantedCapabilities,
  PermissionManager,
} from './types';
import { CapabilityRequiredError } from '../adapters/types';

const STORAGE_KEY = 'walletCapabilities';

/**
 * Check if running in a Chrome extension context
 */
function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    typeof chrome.storage.local !== 'undefined'
  );
}

/**
 * Load capabilities from storage
 */
async function loadCapabilities(): Promise<GrantedCapabilities[]> {
  if (isExtensionContext()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || []);
      });
    });
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Save capabilities to storage
 */
async function saveCapabilities(capabilities: GrantedCapabilities[]): Promise<void> {
  if (isExtensionContext()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: capabilities }, resolve);
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(capabilities));
}

/**
 * Create a PermissionManager instance
 */
export function createPermissionManager(): PermissionManager {
  // In-memory cache of capabilities
  let capabilitiesCache: GrantedCapabilities[] = [];
  let cacheLoaded = false;

  function loadCacheSync(): GrantedCapabilities[] {
    if (!cacheLoaded) {
      const stored = localStorage.getItem(STORAGE_KEY);
      capabilitiesCache = stored ? JSON.parse(stored) : [];
      cacheLoaded = true;
    }
    return capabilitiesCache;
  }

  async function ensureLoaded(): Promise<GrantedCapabilities[]> {
    if (!cacheLoaded) {
      capabilitiesCache = await loadCapabilities();
      cacheLoaded = true;
    }
    return capabilitiesCache;
  }

  return {
    async requestCapabilities(
      request: CapabilityRequest
    ): Promise<GrantedCapabilities | null> {
      // This method should be called after user approval in the UI
      // The UI component handles showing the approval dialog
      // This just records the grant if approved
      
      const capabilities = await ensureLoaded();
      
      // Check if already has capabilities for this origin
      const existingIndex = capabilities.findIndex(
        (c) => c.origin === request.origin
      );

      const grant: GrantedCapabilities = {
        origin: request.origin,
        appName: request.appName,
        appIcon: request.appIcon,
        capabilities: request.capabilities,
        grantedAt: Date.now(),
      };

      if (existingIndex >= 0) {
        // Update existing grant
        capabilities[existingIndex] = grant;
      } else {
        // Add new grant
        capabilities.push(grant);
      }

      capabilitiesCache = capabilities;
      await saveCapabilities(capabilities);

      return grant;
    },

    hasCapability(origin: string, capability: WalletCapability): boolean {
      const cache = loadCacheSync();
      const grant = cache.find((c) => c.origin === origin);
      if (!grant) return false;

      // Check expiration
      if (grant.expiresAt && grant.expiresAt < Date.now()) {
        return false;
      }

      return grant.capabilities.includes(capability);
    },

    getCapabilities(origin: string): WalletCapability[] {
      const cache = loadCacheSync();
      const grant = cache.find((c) => c.origin === origin);
      if (!grant) return [];

      // Check expiration
      if (grant.expiresAt && grant.expiresAt < Date.now()) {
        return [];
      }

      return grant.capabilities;
    },

    revokeCapabilities(origin: string, capabilities?: WalletCapability[]): void {
      let cache = loadCacheSync();
      
      if (!capabilities) {
        // Revoke all capabilities for this origin
        cache = cache.filter((c) => c.origin !== origin);
        capabilitiesCache = cache;
      } else {
        // Revoke specific capabilities
        const grantIndex = cache.findIndex((c) => c.origin === origin);
        if (grantIndex >= 0) {
          const grant = cache[grantIndex];
          grant.capabilities = grant.capabilities.filter(
            (c) => !capabilities.includes(c)
          );
          
          // Remove grant entirely if no capabilities left
          if (grant.capabilities.length === 0) {
            cache.splice(grantIndex, 1);
          }
        }
      }

      saveCapabilities(cache);
    },

    getAllGrantedCapabilities(): GrantedCapabilities[] {
      const cache = loadCacheSync();
      // Filter out expired grants
      const now = Date.now();
      return cache.filter(
        (c) => !c.expiresAt || c.expiresAt > now
      );
    },

    updateLastUsed(origin: string): void {
      const cache = loadCacheSync();
      const grant = cache.find((c) => c.origin === origin);
      if (grant) {
        grant.lastUsed = Date.now();
        saveCapabilities(cache);
      }
    },
  };
}

// Singleton instance
let globalPermissionManager: PermissionManager | null = null;

/**
 * Get the global permission manager instance
 */
export function getPermissionManager(): PermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = createPermissionManager();
  }
  return globalPermissionManager;
}

/**
 * Reset the global permission manager (useful for testing)
 */
export function resetPermissionManager(): void {
  globalPermissionManager = null;
}

/**
 * Check if an operation is allowed for a dApp
 * Throws CapabilityRequiredError if not allowed
 */
export function requireCapability(
  origin: string,
  capability: WalletCapability
): void {
  const pm = getPermissionManager();
  if (!pm.hasCapability(origin, capability)) {
    throw new CapabilityRequiredError(capability);
  }
}
