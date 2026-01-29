export interface ChainConfig {
  chainId: string | number;
  name: string;
  symbol: string;
  rpcUrl: string;
  explorer: string;
}

export interface ChainTransaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'sent' | 'received';
}

export interface ChainToken {
  address: string; // Contract address or token ID
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  logoUrl?: string;
}

export interface ChainAdapter {
  config: ChainConfig;
  
  getBalance(address: string): Promise<string>;
  validateAddress(address: string): boolean;
  getTransactions(address: string): Promise<ChainTransaction[]>;
  getTokens(address: string): Promise<ChainToken[]>;
  sendTransaction(senderPrivateKey: string, to: string, amount: string): Promise<string>; // Returns tx hash
}
