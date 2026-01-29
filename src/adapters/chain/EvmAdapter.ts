import { ChainAdapter, ChainConfig, ChainTransaction, ChainToken } from './types';
import { ethers } from 'ethers';

export class EvmAdapter implements ChainAdapter {
  config: ChainConfig;
  provider: ethers.JsonRpcProvider;

  constructor(config: ChainConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }

  async getBalance(address: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error(`Error fetching balance for ${this.config.name}:`, error);
      return '0';
    }
  }

  validateAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  async getTransactions(_address: string): Promise<ChainTransaction[]> {
    // Ethers v6 doesn't have a simple getHistory. 
    // Usually requires Etherscan or similar indexer.
    // Returning empty for now to match interface.
    return [];
  }

  async getTokens(_address: string): Promise<ChainToken[]> {
    return []; // Handled separately in dashboard for now, or requires indexer
  }

  async sendTransaction(senderPrivateKey: string, to: string, amount: string): Promise<string> {
    const wallet = new ethers.Wallet(senderPrivateKey, this.provider);
    const tx = await wallet.sendTransaction({
      to,
      value: ethers.parseEther(amount)
    });
    return tx.hash;
  }
}
