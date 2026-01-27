import { ChainType } from '../types/chain';
import { ChainConfig } from '../adapters/chain/types';

export const CHAIN_CONFIGS: Record<ChainType, ChainConfig> = {
  [ChainType.EVM]: {
    name: 'Ethereum',
    rpcUrl: 'https://mainnet.infura.io/v3/your-key', // Placeholder, EVM has its own network selector
    chainId: 1,
    symbol: 'ETH',
    explorer: 'https://etherscan.io'
  },
  [ChainType.SOLANA]: {
    name: 'Solana',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    chainId: 101, // Solana Mainnet
    symbol: 'SOL',
    explorer: 'https://solscan.io'
  },
  [ChainType.BITCOIN]: {
    name: 'Bitcoin',
    rpcUrl: 'https://mempool.space/api',
    chainId: 0,
    symbol: 'BTC',
    explorer: 'https://mempool.space'
  },
  [ChainType.TRON]: {
    name: 'TRON',
    rpcUrl: 'https://api.trongrid.io',
    chainId: 0,
    symbol: 'TRX',
    explorer: 'https://tronscan.org'
  },
  [ChainType.COSMOS]: {
    name: 'Cosmos Hub',
    rpcUrl: 'https://rest.cosmos.directory/cosmoshub',
    chainId: 0, // cosmoshub-4
    symbol: 'ATOM',
    explorer: 'https://www.mintscan.io/cosmos'
  }
};

// Optional multi-network lists for non-EVM chains
export const CHAIN_NETWORKS: Record<Exclude<ChainType, ChainType.EVM>, Array<{ id: string; name: string; rpcUrl: string; explorer?: string; isTestnet?: boolean }>> = {
  [ChainType.SOLANA]: [
    { id: 'sol-mainnet', name: 'Mainnet Beta', rpcUrl: 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io' },
    { id: 'sol-devnet', name: 'Devnet', rpcUrl: 'https://api.devnet.solana.com', explorer: 'https://solscan.io?cluster=devnet', isTestnet: true },
    { id: 'sol-testnet', name: 'Testnet', rpcUrl: 'https://api.testnet.solana.com', explorer: 'https://solscan.io?cluster=testnet', isTestnet: true }
  ],
  [ChainType.BITCOIN]: [
    { id: 'btc-mainnet', name: 'Mainnet', rpcUrl: 'https://mempool.space/api', explorer: 'https://mempool.space' },
    { id: 'btc-testnet', name: 'Testnet', rpcUrl: 'https://mempool.space/testnet/api', explorer: 'https://mempool.space/testnet', isTestnet: true }
  ],
  [ChainType.TRON]: [
    { id: 'tron-mainnet', name: 'Mainnet', rpcUrl: 'https://api.trongrid.io', explorer: 'https://tronscan.org' },
    { id: 'tron-shasta', name: 'Shasta Testnet', rpcUrl: 'https://api.shasta.trongrid.io', explorer: 'https://shasta.tronscan.org', isTestnet: true }
  ],
  [ChainType.COSMOS]: [
    { id: 'cosmoshub', name: 'Cosmos Hub', rpcUrl: 'https://rest.cosmos.directory/cosmoshub', explorer: 'https://www.mintscan.io/cosmos' },
    { id: 'cosmoshub-alt', name: 'Cosmos Hub (Alt)', rpcUrl: 'https://lcd.cosmoshub.strange.love', explorer: 'https://www.mintscan.io/cosmos' }
  ]
};
