import { ChainAdapter, ChainConfig, ChainTransaction, ChainToken } from './types';

export class SolanaAdapter implements ChainAdapter {
  config: ChainConfig;

  constructor(config: ChainConfig) {
    this.config = config;
  }

  async getBalance(address: string): Promise<string> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address]
        })
      });
      const data = await response.json();
      if (data.result !== undefined && data.result.value !== undefined) {
        return (data.result.value / 1e9).toString();
      }
      return '0';
    } catch (error) {
      console.error(`Error fetching balance for ${this.config.name}:`, error);
      return '0';
    }
  }

  validateAddress(address: string): boolean {
    // Basic base58 check length 32-44
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  async getTransactions(address: string): Promise<ChainTransaction[]> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [address, { limit: 10 }]
        })
      });
      const data = await response.json();
      if (data.result) {
        const signatures = data.result;
        
        // Fetch details for each signature
        const txDetails = await Promise.all(signatures.map(async (sig: any) => {
          try {
            const txResponse = await fetch(this.config.rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [
                  sig.signature,
                  { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                ]
              })
            });
            const txData = await txResponse.json();
            
            if (!txData.result) {
              // Fallback if details fetch fails
              return {
                hash: sig.signature,
                from: address,
                to: 'Unknown',
                amount: 0,
                timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
                status: sig.err ? 'failed' : 'confirmed',
                type: 'sent' as 'sent' | 'received'
              };
            }
            
            const tx = txData.result;
            const meta = tx.meta;
            const message = tx.transaction.message;
            
            // Determine amount and type by checking balance changes
            let amount = 0;
            let type: 'sent' | 'received' = 'sent';
            let from = 'Unknown';
            let to = 'Unknown';
            
            // Handle account keys structure (jsonParsed vs legacy)
            const accountKeys = message.accountKeys.map((k: any) => typeof k === 'string' ? k : k.pubkey);
            const accountIndex = accountKeys.findIndex((k: string) => k === address);
            
            if (accountIndex !== -1 && meta && meta.preBalances && meta.postBalances) {
              const preBalance = meta.preBalances[accountIndex];
              const postBalance = meta.postBalances[accountIndex];
              const diff = postBalance - preBalance;
              
              amount = Math.abs(diff) / 1e9;
              type = diff < 0 ? 'sent' : 'received';
              
              if (type === 'sent') {
                from = address;
                // Try to find recipient (simplified: find first account with positive balance change)
                // This is heuristic and might not be accurate for complex txs
                const recipientIndex = meta.postBalances.findIndex((bal: number, idx: number) => bal > meta.preBalances[idx] && idx !== accountIndex);
                if (recipientIndex !== -1) {
                  to = accountKeys[recipientIndex];
                }
              } else {
                to = address;
                // Try to find sender (simplified: find first account with negative balance change)
                const senderIndex = meta.postBalances.findIndex((bal: number, idx: number) => bal < meta.preBalances[idx] && idx !== accountIndex);
                if (senderIndex !== -1) {
                  from = accountKeys[senderIndex];
                }
              }
            }

            return {
              hash: sig.signature,
              from,
              to,
              amount,
              timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
              status: sig.err ? 'failed' : 'confirmed',
              type
            };
          } catch (e) {
            // Fallback on error
            return {
              hash: sig.signature,
              from: address,
              to: 'Unknown',
              amount: 0,
              timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
              status: sig.err ? 'failed' : 'confirmed',
              type: 'sent' as 'sent' | 'received'
            };
          }
        }));

        return txDetails;
      }
      return [];
    } catch (error) {
      console.error(`Error fetching transactions for ${this.config.name}:`, error);
      return [];
    }
  }

  async getTokens(address: string): Promise<ChainToken[]> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            address,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
            { encoding: 'jsonParsed' }
          ]
        })
      });
      const data = await response.json();
      if (data.result && data.result.value) {
        return data.result.value.map((item: any) => {
          const info = item.account.data.parsed.info;
          return {
            address: info.mint,
            name: 'Unknown Token', // Metadata requires another call
            symbol: 'SPL',
            decimals: info.tokenAmount.decimals,
            balance: info.tokenAmount.uiAmountString,
            logoUrl: undefined
          };
        }).filter((t: any) => parseFloat(t.balance) > 0);
      }
      return [];
    } catch (error) {
      console.error(`Error fetching tokens for ${this.config.name}:`, error);
      return [];
    }
  }

  async sendTransaction(_senderPrivateKey: string, to: string, amount: string): Promise<string> {
    // Mock implementation for demo purposes
    // Real implementation requires @solana/web3.js and signing
    console.log(`[Mock] Sending ${amount} SOL to ${to}`);
    return new Promise((resolve) => {
      setTimeout(() => {
        // Return a fake signature
        resolve('5' + Array(87).fill(0).map(() => Math.floor(Math.random()*16).toString(16)).join(''));
      }, 1500);
    });
  }
}
