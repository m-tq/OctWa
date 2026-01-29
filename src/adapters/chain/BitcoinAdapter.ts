import { ChainAdapter, ChainConfig, ChainTransaction, ChainToken } from './types';

export class BitcoinAdapter implements ChainAdapter {
  config: ChainConfig;

  constructor(config: ChainConfig) {
    this.config = config;
  }

  async getBalance(address: string): Promise<string> {
    try {
      // Assuming Esplora-like API (e.g. mempool.space)
      // config.rpcUrl should be the base URL e.g. https://mempool.space/api
      const response = await fetch(`${this.config.rpcUrl}/address/${address}`);
      const data = await response.json();
      const chain_stats = data.chain_stats;
      const mempool_stats = data.mempool_stats;
      const satoshis = (chain_stats.funded_txo_sum - chain_stats.spent_txo_sum) + (mempool_stats.funded_txo_sum - mempool_stats.spent_txo_sum);
      return (satoshis / 1e8).toString();
    } catch (error) {
      console.error(`Error fetching balance for ${this.config.name}:`, error);
      return '0';
    }
  }

  validateAddress(address: string): boolean {
    // Basic regex for P2PKH (1), P2SH (3), Bech32 (bc1)
    return /^(1|3|bc1)[a-zA-Z0-9]{25,59}$/.test(address);
  }

  async getTransactions(address: string): Promise<ChainTransaction[]> {
    try {
      const response = await fetch(`${this.config.rpcUrl}/address/${address}/txs`);
      const data = await response.json();
      
      if (!Array.isArray(data)) return [];

      return data.map((tx: any) => {
        // Check if any input is from this address
        const isSent = tx.vin.some((input: any) => 
          input.prevout && input.prevout.scriptpubkey_address === address
        );
        
        let amount = 0;
        let otherParty = 'Unknown';
        
        if (isSent) {
          // Sent transaction
          // Sum outputs that are NOT to self (change)
          const recipients = tx.vout.filter((out: any) => out.scriptpubkey_address !== address);
          amount = recipients.reduce((acc: number, out: any) => acc + out.value, 0);
          
          if (recipients.length > 0) {
            otherParty = recipients[0].scriptpubkey_address;
            if (recipients.length > 1) otherParty += ` +${recipients.length - 1}`;
          }
        } else {
          // Received transaction
          // Sum outputs TO self
          const myOutputs = tx.vout.filter((out: any) => out.scriptpubkey_address === address);
          amount = myOutputs.reduce((acc: number, out: any) => acc + out.value, 0);
          
          // Try to find sender from inputs
          if (tx.vin.length > 0 && tx.vin[0].prevout) {
            otherParty = tx.vin[0].prevout.scriptpubkey_address;
          }
        }

        return {
          hash: tx.txid,
          from: isSent ? address : otherParty,
          to: isSent ? otherParty : address,
          amount: amount / 1e8,
          timestamp: tx.status.block_time ? tx.status.block_time * 1000 : Date.now(),
          status: tx.status.confirmed ? 'confirmed' : 'pending',
          type: isSent ? 'sent' : 'received'
        };
      });
    } catch (error) {
      console.error(`Error fetching transactions for ${this.config.name}:`, error);
      return [];
    }
  }

  async getTokens(_address: string): Promise<ChainToken[]> {
    return []; // No token support for Bitcoin in this version
  }

  async sendTransaction(_senderPrivateKey: string, to: string, amount: string): Promise<string> {
    // Mock implementation for demo purposes
    // Real implementation requires bitcoinjs-lib and signing
    console.log(`[Mock] Sending ${amount} BTC to ${to}`);
    return new Promise((resolve) => {
      setTimeout(() => {
        // Return a fake txid
        resolve(Array(64).fill(0).map(() => Math.floor(Math.random()*16).toString(16)).join(''));
      }, 1500);
    });
  }
}
