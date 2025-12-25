/**
 * AdapterFactory - Factory for creating and managing client adapters
 * Returns the appropriate adapter based on configuration
 * 
 * Requirements: 1.5
 */

import { OctraClientAdapter, ClientType, AdapterFactoryConfig } from './types';
import { PreClientAdapter } from './preClientAdapter';
import { NextClientAdapter } from './nextClientAdapter';

/**
 * AdapterFactory interface
 */
export interface AdapterFactory {
  /** Get the current adapter instance */
  getAdapter(): OctraClientAdapter;
  /** Switch to a different client type */
  switchClient(type: ClientType): void;
  /** Get current client type */
  getClientType(): ClientType;
}

/**
 * Create an adapter factory with the given configuration
 */
export function createAdapterFactory(config: AdapterFactoryConfig): AdapterFactory {
  let currentType = config.clientType;
  let currentAdapter: OctraClientAdapter | null = null;

  function createAdapter(type: ClientType): OctraClientAdapter {
    switch (type) {
      case 'pre-client':
        return new PreClientAdapter();
      case 'next-client':
        return new NextClientAdapter();
      default:
        throw new Error(`Unknown client type: ${type}`);
    }
  }

  return {
    getAdapter(): OctraClientAdapter {
      if (!currentAdapter) {
        currentAdapter = createAdapter(currentType);
      }
      return currentAdapter;
    },

    switchClient(type: ClientType): void {
      if (type !== currentType) {
        // Disconnect current adapter if connected
        if (currentAdapter?.isConnected()) {
          currentAdapter.disconnect().catch(console.error);
        }
        currentType = type;
        currentAdapter = createAdapter(type);
      }
    },

    getClientType(): ClientType {
      return currentType;
    },
  };
}

// Default configuration
const DEFAULT_CONFIG: AdapterFactoryConfig = {
  clientType: 'pre-client',
};

// Singleton factory instance
let globalFactory: AdapterFactory | null = null;

/**
 * Get the global adapter factory instance
 */
export function getAdapterFactory(): AdapterFactory {
  if (!globalFactory) {
    globalFactory = createAdapterFactory(DEFAULT_CONFIG);
  }
  return globalFactory;
}

/**
 * Initialize the global adapter factory with custom configuration
 */
export function initAdapterFactory(config: AdapterFactoryConfig): AdapterFactory {
  globalFactory = createAdapterFactory(config);
  return globalFactory;
}

/**
 * Reset the global adapter factory (useful for testing)
 */
export function resetAdapterFactory(): void {
  if (globalFactory) {
    const adapter = globalFactory.getAdapter();
    if (adapter.isConnected()) {
      adapter.disconnect().catch(console.error);
    }
  }
  globalFactory = null;
}

/**
 * Convenience function to get the current adapter
 */
export function getAdapter(): OctraClientAdapter {
  return getAdapterFactory().getAdapter();
}
