import { ChainAdapter, ChainConfig, ChainTransaction, ChainToken } from './types';

export class CosmosAdapter implements ChainAdapter {
  config: ChainConfig;

  constructor(config: ChainConfig) {
    this.config = config;
  }

  async getBalance(address: string): Promise<string> {
    try {
      const response = await fetch(`${this.config.rpcUrl}/cosmos/bank/v1beta1/balances/${address}`);
      const data = await response.json();
      const balances = data.balances || [];
      // Default to the first balance or look for specific denom if configured
      // For now, assume uatom or taking the first one
      if (balances.length > 0) {
        const primary = balances.find((b: any) => b.denom === 'uatom') || balances[0];
        return (parseInt(primary.amount) / 1e6).toString();
      }
      return '0';
    } catch (error) {
      console.error(`Error fetching balance for ${this.config.name}:`, error);
      return '0';
    }
  }

  validateAddress(address: string): boolean {
    return address.startsWith('cosmos') && address.length > 20;
  }

  async getTransactions(address: string): Promise<ChainTransaction[]> {
    try {
      // Fetch sent transactions
      const sentPromise = fetch(`${this.config.rpcUrl}/cosmos/tx/v1beta1/txs?events=message.sender='${address}'&pagination.limit=10`)
        .then(res => res.json());
        
      // Fetch received transactions
      const receivedPromise = fetch(`${this.config.rpcUrl}/cosmos/tx/v1beta1/txs?events=transfer.recipient='${address}'&pagination.limit=10`)
        .then(res => res.json());

      const [sentData, receivedData] = await Promise.all([sentPromise, receivedPromise]);
      
      const transactions: ChainTransaction[] = [];
      
      const processTx = (txResponse: any, txBody: any, type: 'sent' | 'received') => {
        // Try to parse amount from messages
        let amount = 0;
        let otherParty = 'Unknown';
        
        if (txBody && txBody.messages) {
          for (const msg of txBody.messages) {
            // Check for MsgSend
            if (msg['@type'] === '/cosmos.bank.v1beta1.MsgSend') {
              // Calculate amount (sum up uatom)
              if (msg.amount) {
                for (const coin of msg.amount) {
                  if (coin.denom === 'uatom') {
                    amount += parseInt(coin.amount);
                  }
                }
              }
              // Get other party
              if (type === 'sent') {
                otherParty = msg.to_address;
              } else {
                otherParty = msg.from_address;
              }
            }
          }
        }
        
        return {
          hash: txResponse.txhash,
          from: type === 'sent' ? address : otherParty,
          to: type === 'received' ? address : otherParty,
          amount: amount / 1e6,
          timestamp: new Date(txResponse.timestamp).getTime(),
          status: txResponse.code === 0 ? 'confirmed' : 'failed',
          type
        } as ChainTransaction;
      };

      // Process sent
      if (sentData.tx_responses && sentData.txs) {
        sentData.tx_responses.forEach((res: any, index: number) => {
          transactions.push(processTx(res, sentData.txs[index]?.body, 'sent'));
        });
      }

      // Process received
      if (receivedData.tx_responses && receivedData.txs) {
        receivedData.tx_responses.forEach((res: any, index: number) => {
          // Avoid duplicates if self-transfer
          if (!transactions.some(t => t.hash === res.txhash)) {
            transactions.push(processTx(res, receivedData.txs[index]?.body, 'received'));
          }
        });
      }

      // Sort by timestamp desc
      return transactions.sort((a, b) => b.timestamp - a.timestamp);
      
    } catch (error) {
      console.error(`Error fetching transactions for ${this.config.name}:`, error);
      return [];
    }
  }

  async getTokens(address: string): Promise<ChainToken[]> {
    try {
      const response = await fetch(`${this.config.rpcUrl}/cosmos/bank/v1beta1/balances/${address}`);
      const data = await response.json();
      const balances = data.balances || [];
      
      return balances.map((b: any) => ({
        address: b.denom,
        name: b.denom, 
        symbol: b.denom.startsWith('u') ? b.denom.slice(1).toUpperCase() : b.denom,
        decimals: 6, 
        balance: (parseInt(b.amount) / 1e6).toString(),
        logoUrl: undefined
      })).filter((t: any) => t.name !== 'uatom' && parseFloat(t.balance) > 0);
    } catch (error) {
      console.error(`Error fetching tokens for ${this.config.name}:`, error);
      return [];
    }
  }

  async sendTransaction(_senderPrivateKey: string, to: string, amount: string): Promise<string> {
    // Mock implementation for demo purposes
    console.log(`[Mock] Sending ${amount} ATOM to ${to}`);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(Array(64).fill(0).map(() => Math.floor(Math.random()*16).toString(16)).join(''));
      }, 1500);
    });
  }
}
