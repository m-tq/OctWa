import { ChainType } from '../../utils/keyManager';
import { ChainAdapter, ChainConfig } from './types';
import { EvmAdapter } from './EvmAdapter';
import { SolanaAdapter } from './SolanaAdapter';
import { BitcoinAdapter } from './BitcoinAdapter';
import { TronAdapter } from './TronAdapter';
import { CosmosAdapter } from './CosmosAdapter';

export * from './types';
export * from './EvmAdapter';
export * from './SolanaAdapter';
export * from './BitcoinAdapter';
export * from './TronAdapter';
export * from './CosmosAdapter';

export const AdapterClasses: Record<string, any> = {
  [ChainType.EVM]: EvmAdapter,
  [ChainType.SOLANA]: SolanaAdapter,
  [ChainType.BITCOIN]: BitcoinAdapter,
  [ChainType.TRON]: TronAdapter,
  [ChainType.COSMOS]: CosmosAdapter
};

export function createAdapter(type: ChainType, config: ChainConfig): ChainAdapter {
  const AdapterClass = AdapterClasses[type];
  if (!AdapterClass) throw new Error(`Unknown chain type: ${type}`);
  return new AdapterClass(config);
}
