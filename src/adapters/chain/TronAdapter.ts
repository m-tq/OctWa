import { ChainAdapter, ChainConfig, ChainTransaction, ChainToken } from './types';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

export class TronAdapter implements ChainAdapter {
  config: ChainConfig;

  constructor(config: ChainConfig) {
    this.config = config;
  }

  private hexToBase58(hex: string): string {
    if (!hex) return 'Unknown';
    try {
      // If already base58
      if (hex.startsWith('T')) return hex;
      
      // If hex (TRON addresses start with 41 in hex)
      if (hex.match(/^[0-9a-fA-F]+$/)) {
        const data = Buffer.from(hex, 'hex');
        const hash1 = ethers.getBytes(ethers.sha256(data));
        const hash2 = ethers.getBytes(ethers.sha256(hash1));
        const checksum = hash2.slice(0, 4);
        const addressBytes = Buffer.concat([data, Buffer.from(checksum)]);
        return bs58.encode(addressBytes);
      }
      return hex;
    } catch (e) {
      return hex;
    }
  }

  async getBalance(address: string): Promise<string> {
    try {
      // Trongrid API
      const response = await fetch(`${this.config.rpcUrl}/wallet/getaccount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address, visible: true })
      });
      const data = await response.json();
      if (data.balance) {
        return (data.balance / 1e6).toString();
      }
      return '0';
    } catch (error) {
      console.error(`Error fetching balance for ${this.config.name}:`, error);
      return '0';
    }
  }

  validateAddress(address: string): boolean {
    return address.startsWith('T') && address.length === 34;
  }

  async getTransactions(address: string): Promise<ChainTransaction[]> {
    try {
      const response = await fetch(`${this.config.rpcUrl}/v1/accounts/${address}/transactions?limit=20`);
      const data = await response.json();
      
      if (data.data) {
        return data.data.map((tx: any) => {
          const contract = tx.raw_data.contract[0];
          const type = contract.type;
          let amount = 0;
          let from = 'Unknown';
          let to = 'Unknown';
          
          if (type === 'TransferContract') {
            const val = contract.parameter.value;
            amount = (val.amount || 0) / 1e6;
            from = this.hexToBase58(val.owner_address);
            to = this.hexToBase58(val.to_address);
          } else if (type === 'TriggerSmartContract') {
             // Basic support for TRC20 transfers if visible in value
             // Usually requires parsing event logs which is harder here
             from = this.hexToBase58(contract.parameter.value.owner_address);
             to = this.hexToBase58(contract.parameter.value.contract_address);
          }

          const isSent = from === address;

          return {
            hash: tx.txID,
            from: from,
            to: to,
            amount: amount,
            timestamp: tx.block_timestamp,
            status: 'confirmed', // TronGrid returns confirmed txs usually
            type: isSent ? 'sent' : 'received'
          };
        });
      }
      return [];
    } catch (error) {
      console.error(`Error fetching transactions for ${this.config.name}:`, error);
      return [];
    }
  }

  async getTokens(_address: string): Promise<ChainToken[]> {
    return []; // No token support in this version
  }

  async sendTransaction(_senderPrivateKey: string, to: string, amount: string): Promise<string> {
    // Mock implementation for demo purposes
    console.log(`[Mock] Sending ${amount} TRX to ${to}`);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(Array(64).fill(0).map(() => Math.floor(Math.random()*16).toString(16)).join(''));
      }, 1500);
    });
  }
}
