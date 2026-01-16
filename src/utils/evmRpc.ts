/**
 * EVM RPC utilities for fetching balances and interacting with EVM chains
 */

export interface EVMNetwork {
  id: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  explorer: string;
  isTestnet: boolean;
}

export const DEFAULT_EVM_NETWORKS: EVMNetwork[] = [
  {
    id: 'eth-mainnet',
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://mainnet.infura.io/v3/121cf128273c4f0cb73770b391070d3b',
    symbol: 'ETH',
    explorer: 'https://etherscan.io',
    isTestnet: false
  },
  {
    id: 'eth-sepolia',
    name: 'Sepolia Testnet',
    chainId: 11155111,
    rpcUrl: 'https://sepolia.infura.io/v3/121cf128273c4f0cb73770b391070d3b',
    symbol: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
    isTestnet: true
  }
];

// Storage key for custom RPC URLs
const EVM_RPC_STORAGE_KEY = 'evm_rpc_providers';
const ACTIVE_EVM_NETWORK_KEY = 'active_evm_network';

/**
 * Get stored RPC providers
 */
export function getStoredEVMProviders(): Record<string, string> {
  try {
    const stored = localStorage.getItem(EVM_RPC_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Save custom RPC URL for a network
 */
export function saveEVMProvider(networkId: string, rpcUrl: string): void {
  const providers = getStoredEVMProviders();
  providers[networkId] = rpcUrl;
  localStorage.setItem(EVM_RPC_STORAGE_KEY, JSON.stringify(providers));
}

/**
 * Get RPC URL for a network (custom or default)
 */
export function getEVMRpcUrl(networkId: string): string {
  const customProviders = getStoredEVMProviders();
  if (customProviders[networkId]) {
    return customProviders[networkId];
  }
  const network = DEFAULT_EVM_NETWORKS.find(n => n.id === networkId);
  return network?.rpcUrl || DEFAULT_EVM_NETWORKS[0].rpcUrl;
}

/**
 * Get active EVM network
 */
export function getActiveEVMNetwork(): EVMNetwork {
  try {
    const stored = localStorage.getItem(ACTIVE_EVM_NETWORK_KEY);
    if (stored) {
      const network = DEFAULT_EVM_NETWORKS.find(n => n.id === stored);
      if (network) return network;
    }
  } catch {}
  return DEFAULT_EVM_NETWORKS[0];
}

/**
 * Set active EVM network
 */
export function setActiveEVMNetwork(networkId: string): void {
  localStorage.setItem(ACTIVE_EVM_NETWORK_KEY, networkId);
}

/**
 * Make JSON-RPC call
 */
async function rpcCall(rpcUrl: string, method: string, params: any[]): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC error');
  }

  return data.result;
}

/**
 * Get ETH balance for an address
 */
export async function getEVMBalance(address: string, networkId?: string): Promise<string> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const balanceHex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
    const balanceWei = BigInt(balanceHex);
    const balanceEth = Number(balanceWei) / 1e18;
    return balanceEth.toFixed(6);
  } catch (error) {
    console.error('Failed to fetch EVM balance:', error);
    throw error;
  }
}

/**
 * Get ERC20 token balance
 */
export async function getERC20Balance(
  tokenAddress: string, 
  walletAddress: string, 
  decimals: number = 18,
  networkId?: string
): Promise<string> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  // balanceOf(address) function selector
  const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');
  
  try {
    const result = await rpcCall(rpcUrl, 'eth_call', [
      { to: tokenAddress, data },
      'latest'
    ]);
    
    const balanceWei = BigInt(result);
    const balance = Number(balanceWei) / Math.pow(10, decimals);
    return balance.toFixed(6);
  } catch (error) {
    console.error('Failed to fetch ERC20 balance:', error);
    throw error;
  }
}

/**
 * Check RPC connection status
 */
export async function checkEVMRpcStatus(networkId?: string): Promise<boolean> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    await rpcCall(rpcUrl, 'eth_blockNumber', []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get transaction count (nonce)
 */
export async function getEVMTransactionCount(address: string, networkId?: string): Promise<number> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const countHex = await rpcCall(rpcUrl, 'eth_getTransactionCount', [address, 'latest']);
    return parseInt(countHex, 16);
  } catch (error) {
    console.error('Failed to fetch transaction count:', error);
    throw error;
  }
}

/**
 * Get gas price
 */
export async function getEVMGasPrice(networkId?: string): Promise<string> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const gasPriceHex = await rpcCall(rpcUrl, 'eth_gasPrice', []);
    const gasPriceWei = BigInt(gasPriceHex);
    const gasPriceGwei = Number(gasPriceWei) / 1e9;
    return gasPriceGwei.toFixed(2);
  } catch (error) {
    console.error('Failed to fetch gas price:', error);
    throw error;
  }
}

export interface EVMTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  status: 'confirmed' | 'pending';
  type: 'sent' | 'received';
}

export interface ERC20Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  isLoading: boolean;
}

// USDT contract addresses
export const USDT_CONTRACTS: Record<number, string> = {
  1: '0xdac17f958d2ee523a2206206994597c13d831ec7', // Mainnet
  11155111: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', // Sepolia (example, may not exist)
};

/**
 * Get USDT balance using Etherscan API V2
 */
export async function getUSDTBalance(
  address: string,
  networkId?: string
): Promise<string> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const usdtContract = USDT_CONTRACTS[network.chainId];
  if (!usdtContract) {
    return '0.000000';
  }
  
  const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
  const apiUrl = 'https://api.etherscan.io/v2/api';
  
  try {
    const response = await fetch(
      `${apiUrl}?chainid=${network.chainId}&module=account&action=tokenbalance&contractaddress=${usdtContract}&address=${address}&tag=latest&apikey=${apiKey}`
    );
    
    if (!response.ok) throw new Error('Failed to fetch USDT balance');
    
    const data = await response.json();
    
    if (data.status !== '1') {
      console.error('Etherscan API error:', data.message);
      return '0.000000';
    }
    
    // USDT has 6 decimals
    const balance = Number(data.result) / 1e6;
    return balance.toFixed(6);
  } catch (error) {
    console.error('Failed to fetch USDT balance:', error);
    return '0.000000';
  }
}

/**
 * Get USDT token transactions using Etherscan API V2
 */
export async function getUSDTTransactions(
  address: string,
  networkId?: string
): Promise<EVMTransaction[]> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const usdtContract = USDT_CONTRACTS[network.chainId];
  if (!usdtContract) {
    return [];
  }
  
  const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
  const apiUrl = 'https://api.etherscan.io/v2/api';
  
  try {
    const url = `${apiUrl}?chainid=${network.chainId}&module=account&action=tokentx&contractaddress=${usdtContract}&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${apiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch USDT transactions');
    }
    
    const data = await response.json();
    
    if (data.status !== '1') {
      // Silent fail for "No transactions found"
      return [];
    }
    
    return data.result.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(tx.value) / 1e6).toFixed(6), // USDT has 6 decimals
      timestamp: Number(tx.timeStamp) * 1000,
      status: 'confirmed',
      type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
    }));
  } catch (error) {
    console.error('Failed to fetch USDT transactions:', error);
    return [];
  }
}

/**
 * Get recent transactions (using Etherscan API V2)
 */
export async function getEVMTransactions(
  address: string, 
  networkId?: string
): Promise<EVMTransaction[]> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
  // Use single base URL for all networks with chainid parameter
  const apiUrl = 'https://api.etherscan.io/v2/api';
  
  try {
    const url = `${apiUrl}?chainid=${network.chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${apiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch transactions');
    }
    
    const data = await response.json();
    
    if (data.status !== '1') {
      // Silent fail for "No transactions found"
      return [];
    }
    
    return data.result.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(tx.value) / 1e18).toFixed(6),
      timestamp: Number(tx.timeStamp) * 1000,
      status: tx.isError === '0' ? 'confirmed' : 'confirmed',
      type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
    }));
  } catch (error) {
    console.error('Failed to fetch ETH transactions:', error);
    return [];
  }
}


/**
 * Get display name for RPC URL (hide API keys)
 */
export function getRpcDisplayName(rpcUrl: string): string {
  try {
    const url = new URL(rpcUrl);
    return url.hostname;
  } catch {
    return rpcUrl.slice(0, 30) + '...';
  }
}

// Cache for ETH price
let ethPriceCache: { price: number; timestamp: number } | null = null;
const ETH_PRICE_CACHE_DURATION = 60000; // 1 minute cache

/**
 * Get ETH price in USD from CoinGecko API
 * Uses cache to avoid rate limiting
 */
export async function getETHPrice(): Promise<number | null> {
  // Check cache first
  if (ethPriceCache && Date.now() - ethPriceCache.timestamp < ETH_PRICE_CACHE_DURATION) {
    return ethPriceCache.price;
  }

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch ETH price');
    }

    const data = await response.json();
    const price = data.ethereum?.usd;

    if (typeof price === 'number') {
      ethPriceCache = { price, timestamp: Date.now() };
      return price;
    }

    return null;
  } catch (error) {
    console.error('Failed to fetch ETH price:', error);
    // Return cached price if available, even if expired
    return ethPriceCache?.price ?? null;
  }
}

/**
 * Calculate USD value from ETH amount
 */
export function calculateUSDValue(ethAmount: string | number, ethPrice: number | null): string | null {
  if (ethPrice === null) return null;
  const amount = typeof ethAmount === 'string' ? parseFloat(ethAmount) : ethAmount;
  if (isNaN(amount)) return null;
  const usdValue = amount * ethPrice;
  return usdValue.toLocaleString('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2 
  });
}


/**
 * Send ETH transaction
 */
export async function sendEVMTransaction(
  privateKeyHex: string,
  to: string,
  amountEth: string,
  networkId?: string,
  data?: string // Optional hex data for intent payload
): Promise<string> {
  const network = networkId 
    ? DEFAULT_EVM_NETWORKS.find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    // Import ethers for transaction signing
    const { ethers } = await import('ethers');
    
    // Create provider
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Create wallet from private key
    const wallet = new ethers.Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`, provider);
    
    // Parse amount to wei
    const amountWei = ethers.parseEther(amountEth);
    
    // Create transaction object
    const txRequest: { to: string; value: bigint; data?: string } = {
      to,
      value: amountWei,
    };
    
    // Add data if provided (for intent payload)
    if (data) {
      txRequest.data = data.startsWith('0x') ? data : `0x${data}`;
    }
    
    // Create transaction
    const tx = await wallet.sendTransaction(txRequest);
    
    // Wait for transaction to be mined
    await tx.wait();
    
    return tx.hash;
  } catch (error: any) {
    console.error('Failed to send transaction:', error);
    throw new Error(error.message || 'Transaction failed');
  }
}
