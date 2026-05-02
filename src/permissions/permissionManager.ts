// Manages wallet capabilities for dApps — persisted in localStorage/chrome.storage.

import {
  WalletCapability,
  CapabilityRequest,
  GrantedCapabilities,
  PermissionManager,
} from './types';
import { CapabilityRequiredError } from '../adapters/types';

const STORAGE_KEY = 'walletCapabilities';

function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome.storage &&
    typeof chrome.storage.local !== 'undefined'
  );
}

async function loadCapabilities(): Promise<GrantedCapabilities[]> {
  if (isExtensionContext()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] ?? []);
      });
    });
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

async function saveCapabilities(capabilities: GrantedCapabilities[]): Promise<void> {
  if (isExtensionContext()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: capabilities }, resolve);
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(capabilities));
}

export function createPermissionManager(): PermissionManager {
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

  function isGrantExpired(grant: GrantedCapabilities): boolean {
    return !!grant.expiresAt && grant.expiresAt < Date.now();
  }

  return {
    async requestCapabilities(request: CapabilityRequest): Promise<GrantedCapabilities | null> {
      const capabilities = await ensureLoaded();

      const grant: GrantedCapabilities = {
        origin: request.origin,
        appName: request.appName,
        appIcon: request.appIcon,
        capabilities: request.capabilities,
        grantedAt: Date.now(),
      };

      const existingIndex = capabilities.findIndex((c) => c.origin === request.origin);
      if (existingIndex >= 0) {
        capabilities[existingIndex] = grant;
      } else {
        capabilities.push(grant);
      }

      capabilitiesCache = capabilities;
      await saveCapabilities(capabilities);
      return grant;
    },

    hasCapability(origin: string, capability: WalletCapability): boolean {
      const grant = loadCacheSync().find((c) => c.origin === origin);
      if (!grant || isGrantExpired(grant)) return false;
      return grant.capabilities.includes(capability);
    },

    getCapabilities(origin: string): WalletCapability[] {
      const grant = loadCacheSync().find((c) => c.origin === origin);
      if (!grant || isGrantExpired(grant)) return [];
      return grant.capabilities;
    },

    revokeCapabilities(origin: string, capabilities?: WalletCapability[]): void {
      let cache = loadCacheSync();

      if (!capabilities) {
        cache = cache.filter((c) => c.origin !== origin);
        capabilitiesCache = cache;
      } else {
        const grantIndex = cache.findIndex((c) => c.origin === origin);
        if (grantIndex >= 0) {
          const grant = cache[grantIndex];
          grant.capabilities = grant.capabilities.filter((c) => !capabilities.includes(c));
          if (grant.capabilities.length === 0) cache.splice(grantIndex, 1);
        }
      }

      saveCapabilities(cache);
    },

    getAllGrantedCapabilities(): GrantedCapabilities[] {
      return loadCacheSync().filter((c) => !isGrantExpired(c));
    },

    updateLastUsed(origin: string): void {
      const grant = loadCacheSync().find((c) => c.origin === origin);
      if (grant) {
        grant.lastUsed = Date.now();
        saveCapabilities(loadCacheSync());
      }
    },
  };
}

let globalPermissionManager: PermissionManager | null = null;

export function getPermissionManager(): PermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = createPermissionManager();
  }
  return globalPermissionManager;
}

export function resetPermissionManager(): void {
  globalPermissionManager = null;
}

export function requireCapability(origin: string, capability: WalletCapability): void {
  if (!getPermissionManager().hasCapability(origin, capability)) {
    throw new CapabilityRequiredError(capability);
  }
}
