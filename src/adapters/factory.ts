// Factory for creating and managing Octra client adapters.

import { OctraClientAdapter, ClientType, AdapterFactoryConfig } from './types';
import { PreClientAdapter } from './preClientAdapter';
import { NextClientAdapter } from './nextClientAdapter';

export interface AdapterFactory {
  getAdapter(): OctraClientAdapter;
  switchClient(type: ClientType): void;
  getClientType(): ClientType;
}

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
      if (type === currentType) return;

      if (currentAdapter?.isConnected()) {
        currentAdapter.disconnect().catch(console.error);
      }
      currentType = type;
      currentAdapter = createAdapter(type);
    },

    getClientType(): ClientType {
      return currentType;
    },
  };
}

const DEFAULT_CONFIG: AdapterFactoryConfig = { clientType: 'pre-client' };

let globalFactory: AdapterFactory | null = null;

export function getAdapterFactory(): AdapterFactory {
  if (!globalFactory) {
    globalFactory = createAdapterFactory(DEFAULT_CONFIG);
  }
  return globalFactory;
}

export function initAdapterFactory(config: AdapterFactoryConfig): AdapterFactory {
  globalFactory = createAdapterFactory(config);
  return globalFactory;
}

export function resetAdapterFactory(): void {
  if (globalFactory) {
    const adapter = globalFactory.getAdapter();
    if (adapter.isConnected()) {
      adapter.disconnect().catch(console.error);
    }
  }
  globalFactory = null;
}

export function getAdapter(): OctraClientAdapter {
  return getAdapterFactory().getAdapter();
}
