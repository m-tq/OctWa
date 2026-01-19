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
  isCustom?: boolean;
}

// Infura API Key - can be overridden via environment variable
const INFURA_API_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b';

export const DEFAULT_EVM_NETWORKS: EVMNetwork[] = [
  {
    id: 'eth-mainnet',
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    symbol: 'ETH',
    explorer: 'https://etherscan.io',
    isTestnet: false
  },
  {
    id: 'polygon-mainnet',
    name: 'Polygon Mainnet',
    chainId: 137,
    rpcUrl: `https://polygon-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    symbol: 'POL',
    explorer: 'https://polygonscan.com',
    isTestnet: false
  },
  {
    id: 'base-mainnet',
    name: 'Base Mainnet',
    chainId: 8453,
    rpcUrl: `https://base-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    symbol: 'ETH',
    explorer: 'https://basescan.org',
    isTestnet: false
  },
  {
    id: 'bsc-mainnet',
    name: 'BSC Mainnet',
    chainId: 56,
    rpcUrl: `https://bsc-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    symbol: 'BNB',
    explorer: 'https://bscscan.com',
    isTestnet: false
  },
  {
    id: 'eth-sepolia',
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    symbol: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
    isTestnet: true
  }
];

// Storage keys
const EVM_RPC_STORAGE_KEY = 'evm_rpc_providers';
const ACTIVE_EVM_NETWORK_KEY = 'active_evm_network';
const CUSTOM_NETWORKS_KEY = 'evm_custom_networks';
const CUSTOM_TOKENS_KEY = 'evm_custom_tokens';
const CUSTOM_NFTS_KEY = 'evm_custom_nfts';

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
  // Check custom networks
  const customNetworks = getCustomNetworks();
  const customNetwork = customNetworks.find(n => n.id === networkId);
  if (customNetwork) {
    return customNetwork.rpcUrl;
  }
  const network = DEFAULT_EVM_NETWORKS.find(n => n.id === networkId);
  return network?.rpcUrl || DEFAULT_EVM_NETWORKS[0].rpcUrl;
}

/**
 * Get all networks (default + custom)
 */
export function getAllNetworks(): EVMNetwork[] {
  const customNetworks = getCustomNetworks();
  return [...DEFAULT_EVM_NETWORKS, ...customNetworks];
}

/**
 * Get custom networks
 */
export function getCustomNetworks(): EVMNetwork[] {
  try {
    const stored = localStorage.getItem(CUSTOM_NETWORKS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save custom network
 */
export function saveCustomNetwork(network: EVMNetwork): void {
  const networks = getCustomNetworks();
  const existingIndex = networks.findIndex(n => n.id === network.id || n.chainId === network.chainId);
  if (existingIndex >= 0) {
    networks[existingIndex] = { ...network, isCustom: true };
  } else {
    networks.push({ ...network, isCustom: true });
  }
  localStorage.setItem(CUSTOM_NETWORKS_KEY, JSON.stringify(networks));
}

/**
 * Remove custom network
 */
export function removeCustomNetwork(networkId: string): void {
  const networks = getCustomNetworks();
  const filtered = networks.filter(n => n.id !== networkId);
  localStorage.setItem(CUSTOM_NETWORKS_KEY, JSON.stringify(filtered));
}

/**
 * Get active EVM network
 */
export function getActiveEVMNetwork(): EVMNetwork {
  try {
    const stored = localStorage.getItem(ACTIVE_EVM_NETWORK_KEY);
    if (stored) {
      const allNetworks = getAllNetworks();
      const network = allNetworks.find(n => n.id === stored);
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
 * Get network by ID
 */
export function getNetworkById(networkId: string): EVMNetwork | undefined {
  return getAllNetworks().find(n => n.id === networkId);
}

/**
 * Get network by chain ID
 */
export function getNetworkByChainId(chainId: number): EVMNetwork | undefined {
  return getAllNetworks().find(n => n.chainId === chainId);
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
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
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
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
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
 * Get ERC20 token info (name, symbol, decimals)
 */
export async function getERC20TokenInfo(
  tokenAddress: string,
  networkId?: string
): Promise<{ name: string; symbol: string; decimals: number } | null> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    // name() function selector
    const nameData = '0x06fdde03';
    // symbol() function selector
    const symbolData = '0x95d89b41';
    // decimals() function selector
    const decimalsData = '0x313ce567';
    
    const [nameResult, symbolResult, decimalsResult] = await Promise.all([
      rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data: nameData }, 'latest']),
      rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data: symbolData }, 'latest']),
      rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data: decimalsData }, 'latest']),
    ]);
    
    // Decode string results (skip first 64 chars for offset, next 64 for length)
    const decodeString = (hex: string): string => {
      if (!hex || hex === '0x') return '';
      try {
        // Remove 0x prefix
        const data = hex.slice(2);
        // For dynamic string: offset (32 bytes) + length (32 bytes) + data
        if (data.length >= 128) {
          const length = parseInt(data.slice(64, 128), 16);
          const strHex = data.slice(128, 128 + length * 2);
          return Buffer.from(strHex, 'hex').toString('utf8').replace(/\0/g, '');
        }
        // For short strings encoded directly
        return Buffer.from(data, 'hex').toString('utf8').replace(/\0/g, '');
      } catch {
        return '';
      }
    };
    
    const name = decodeString(nameResult);
    const symbol = decodeString(symbolResult);
    const decimals = parseInt(decimalsResult, 16);
    
    if (!name && !symbol) return null;
    
    return { name: name || 'Unknown', symbol: symbol || 'UNK', decimals: isNaN(decimals) ? 18 : decimals };
  } catch (error) {
    console.error('Failed to fetch ERC20 token info:', error);
    return null;
  }
}

/**
 * Check RPC connection status
 */
export async function checkEVMRpcStatus(networkId?: string): Promise<boolean> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
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
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
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
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
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
  tokenSymbol?: string;
  tokenAddress?: string;
}

export interface ERC20Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  isLoading: boolean;
  chainId: number;
}

export interface NFTToken {
  contractAddress: string;
  tokenId: string;
  name: string;
  symbol: string;
  tokenURI?: string;
  imageUrl?: string;
  chainId: number;
}

// USDT contract addresses
export const USDT_CONTRACTS: Record<number, string> = {
  1: '0xdac17f958d2ee523a2206206994597c13d831ec7', // Ethereum Mainnet
  137: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // Polygon
  56: '0x55d398326f99059ff775485246999027b3197955', // BSC
  8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // Base
  11155111: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', // Sepolia (example)
};

// Common ERC20 tokens per chain
export const COMMON_TOKENS: Record<number, Array<{ address: string; name: string; symbol: string; decimals: number }>> = {
  1: [ // Ethereum
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'Tether USD', symbol: 'USDT', decimals: 6 },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 },
  ],
  137: [ // Polygon
    { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', name: 'Tether USD', symbol: 'USDT', decimals: 6 },
    { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 },
  ],
  56: [ // BSC
    { address: '0x55d398326f99059ff775485246999027b3197955', name: 'Tether USD', symbol: 'USDT', decimals: 18 },
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 },
  ],
  8453: [ // Base
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 },
  ],
};

/**
 * Get custom tokens for a chain
 */
export function getCustomTokens(chainId: number): ERC20Token[] {
  try {
    const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
    const allTokens: ERC20Token[] = stored ? JSON.parse(stored) : [];
    return allTokens.filter(t => t.chainId === chainId);
  } catch {
    return [];
  }
}

/**
 * Save custom token
 */
export function saveCustomToken(token: ERC20Token): void {
  try {
    const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
    const allTokens: ERC20Token[] = stored ? JSON.parse(stored) : [];
    const existingIndex = allTokens.findIndex(
      t => t.address.toLowerCase() === token.address.toLowerCase() && t.chainId === token.chainId
    );
    if (existingIndex >= 0) {
      allTokens[existingIndex] = token;
    } else {
      allTokens.push(token);
    }
    localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(allTokens));
  } catch (error) {
    console.error('Failed to save custom token:', error);
  }
}

/**
 * Remove custom token
 */
export function removeCustomToken(address: string, chainId: number): void {
  try {
    const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
    const allTokens: ERC20Token[] = stored ? JSON.parse(stored) : [];
    const filtered = allTokens.filter(
      t => !(t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId)
    );
    localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to remove custom token:', error);
  }
}

/**
 * Get custom NFTs for a chain
 */
export function getCustomNFTs(chainId: number): NFTToken[] {
  try {
    const stored = localStorage.getItem(CUSTOM_NFTS_KEY);
    const allNFTs: NFTToken[] = stored ? JSON.parse(stored) : [];
    return allNFTs.filter(n => n.chainId === chainId);
  } catch {
    return [];
  }
}

/**
 * Save custom NFT
 */
export function saveCustomNFT(nft: NFTToken): void {
  try {
    const stored = localStorage.getItem(CUSTOM_NFTS_KEY);
    const allNFTs: NFTToken[] = stored ? JSON.parse(stored) : [];
    const existingIndex = allNFTs.findIndex(
      n => n.contractAddress.toLowerCase() === nft.contractAddress.toLowerCase() && 
           n.tokenId === nft.tokenId && 
           n.chainId === nft.chainId
    );
    if (existingIndex >= 0) {
      allNFTs[existingIndex] = nft;
    } else {
      allNFTs.push(nft);
    }
    localStorage.setItem(CUSTOM_NFTS_KEY, JSON.stringify(allNFTs));
  } catch (error) {
    console.error('Failed to save custom NFT:', error);
  }
}

/**
 * Remove custom NFT
 */
export function removeCustomNFT(contractAddress: string, tokenId: string, chainId: number): void {
  try {
    const stored = localStorage.getItem(CUSTOM_NFTS_KEY);
    const allNFTs: NFTToken[] = stored ? JSON.parse(stored) : [];
    const filtered = allNFTs.filter(
      n => !(n.contractAddress.toLowerCase() === contractAddress.toLowerCase() && 
             n.tokenId === tokenId && 
             n.chainId === chainId)
    );
    localStorage.setItem(CUSTOM_NFTS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to remove custom NFT:', error);
  }
}

/**
 * Get NFT metadata (ERC721)
 */
export async function getNFTMetadata(
  contractAddress: string,
  tokenId: string,
  networkId?: string
): Promise<{ name: string; symbol: string; tokenURI: string; imageUrl?: string } | null> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    // name() function selector
    const nameData = '0x06fdde03';
    // symbol() function selector
    const symbolData = '0x95d89b41';
    // tokenURI(uint256) function selector
    const tokenURIData = '0xc87b56dd' + BigInt(tokenId).toString(16).padStart(64, '0');
    
    const [nameResult, symbolResult, tokenURIResult] = await Promise.all([
      rpcCall(rpcUrl, 'eth_call', [{ to: contractAddress, data: nameData }, 'latest']).catch(() => '0x'),
      rpcCall(rpcUrl, 'eth_call', [{ to: contractAddress, data: symbolData }, 'latest']).catch(() => '0x'),
      rpcCall(rpcUrl, 'eth_call', [{ to: contractAddress, data: tokenURIData }, 'latest']).catch(() => '0x'),
    ]);
    
    const decodeString = (hex: string): string => {
      if (!hex || hex === '0x') return '';
      try {
        const data = hex.slice(2);
        if (data.length >= 128) {
          const length = parseInt(data.slice(64, 128), 16);
          const strHex = data.slice(128, 128 + length * 2);
          return Buffer.from(strHex, 'hex').toString('utf8').replace(/\0/g, '');
        }
        return Buffer.from(data, 'hex').toString('utf8').replace(/\0/g, '');
      } catch {
        return '';
      }
    };
    
    const name = decodeString(nameResult) || 'Unknown NFT';
    const symbol = decodeString(symbolResult) || 'NFT';
    const tokenURI = decodeString(tokenURIResult);
    
    let imageUrl: string | undefined;
    
    // Try to fetch metadata from tokenURI
    if (tokenURI) {
      try {
        let metadataUrl = tokenURI;
        if (tokenURI.startsWith('ipfs://')) {
          metadataUrl = `https://ipfs.io/ipfs/${tokenURI.slice(7)}`;
        }
        const metadataResponse = await fetch(metadataUrl);
        const metadata = await metadataResponse.json();
        if (metadata.image) {
          imageUrl = metadata.image;
          if (imageUrl?.startsWith('ipfs://')) {
            imageUrl = `https://ipfs.io/ipfs/${imageUrl.slice(7)}`;
          }
        }
      } catch {
        // Ignore metadata fetch errors
      }
    }
    
    return { name, symbol, tokenURI, imageUrl };
  } catch (error) {
    console.error('Failed to fetch NFT metadata:', error);
    return null;
  }
}

/**
 * Check if address owns NFT (ERC721)
 */
export async function checkNFTOwnership(
  contractAddress: string,
  tokenId: string,
  walletAddress: string,
  networkId?: string
): Promise<boolean> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    // ownerOf(uint256) function selector
    const data = '0x6352211e' + BigInt(tokenId).toString(16).padStart(64, '0');
    
    const result = await rpcCall(rpcUrl, 'eth_call', [{ to: contractAddress, data }, 'latest']);
    
    // Decode address (last 40 chars)
    const owner = '0x' + result.slice(-40);
    return owner.toLowerCase() === walletAddress.toLowerCase();
  } catch (error) {
    console.error('Failed to check NFT ownership:', error);
    return false;
  }
}

/**
 * Get USDT balance using Etherscan API V2
 */
export async function getUSDTBalance(
  address: string,
  networkId?: string
): Promise<string> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const usdtContract = USDT_CONTRACTS[network.chainId];
  if (!usdtContract) {
    return '0.000000';
  }
  
  // Use RPC call instead of Etherscan API for better multi-chain support
  try {
    const decimals = network.chainId === 56 ? 18 : 6; // BSC USDT has 18 decimals
    return await getERC20Balance(usdtContract, address, decimals, networkId);
  } catch (error) {
    console.error('Failed to fetch USDT balance:', error);
    return '0.000000';
  }
}

/**
 * Get explorer API URL for a network (Etherscan API V2)
 */
function getExplorerApiUrl(chainId: number): string {
  // Etherscan API V2 uses a unified endpoint with chainid parameter
  // https://docs.etherscan.io/v2-migration
  return 'https://api.etherscan.io/v2/api';
}

/**
 * Get USDT token transactions using Etherscan API V2
 */
export async function getUSDTTransactions(
  address: string,
  networkId?: string
): Promise<EVMTransaction[]> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const usdtContract = USDT_CONTRACTS[network.chainId];
  if (!usdtContract) {
    return [];
  }
  
  const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
  
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=${network.chainId}&module=account&action=tokentx&contractaddress=${usdtContract}&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch USDT transactions');
    }
    
    const data = await response.json();
    
    if (data.status !== '1' || !Array.isArray(data.result)) {
      return [];
    }
    
    const decimals = network.chainId === 56 ? 18 : 6;
    
    return data.result.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(tx.value) / Math.pow(10, decimals)).toFixed(6),
      timestamp: Number(tx.timeStamp) * 1000,
      status: 'confirmed',
      type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
      tokenSymbol: 'USDT',
      tokenAddress: usdtContract,
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
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
  
  try {
    // Etherscan API V2 with chainid parameter
    const url = `https://api.etherscan.io/v2/api?chainid=${network.chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('EVM Transactions API response not ok:', response.status);
      return [];
    }
    
    const data = await response.json();
    
    // Handle various API response formats
    if (data.status === '0' && data.message === 'No transactions found') {
      return [];
    }
    
    if (data.status !== '1' || !Array.isArray(data.result)) {
      console.error('EVM Transactions API error:', data.message || data.result || 'Unknown error');
      return [];
    }
    
    return data.result.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || '',
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

// Cache for native token prices
const priceCache: Record<string, { price: number; timestamp: number }> = {};
const PRICE_CACHE_DURATION = 60000; // 1 minute cache

/**
 * Get native token price in USD from CoinGecko API
 */
export async function getNativeTokenPrice(symbol: string): Promise<number | null> {
  const coinIds: Record<string, string> = {
    'ETH': 'ethereum',
    'POL': 'matic-network',
    'MATIC': 'matic-network',
    'BNB': 'binancecoin',
  };
  
  const coinId = coinIds[symbol.toUpperCase()];
  if (!coinId) return null;
  
  // Check cache first
  if (priceCache[coinId] && Date.now() - priceCache[coinId].timestamp < PRICE_CACHE_DURATION) {
    return priceCache[coinId].price;
  }

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch price');
    }

    const data = await response.json();
    const price = data[coinId]?.usd;

    if (typeof price === 'number') {
      priceCache[coinId] = { price, timestamp: Date.now() };
      return price;
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch ${symbol} price:`, error);
    return priceCache[coinId]?.price ?? null;
  }
}

/**
 * Get ETH price in USD (backward compatible)
 */
export async function getETHPrice(): Promise<number | null> {
  return getNativeTokenPrice('ETH');
}

/**
 * Calculate USD value from token amount
 */
export function calculateUSDValue(amount: string | number, price: number | null): string | null {
  if (price === null) return null;
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) return null;
  const usdValue = numAmount * price;
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
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
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

/**
 * Send ERC20 token transaction
 */
export async function sendERC20Transaction(
  privateKeyHex: string,
  tokenAddress: string,
  to: string,
  amount: string,
  decimals: number = 18,
  networkId?: string
): Promise<string> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const { ethers } = await import('ethers');
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`, provider);
    
    // ERC20 transfer function ABI
    const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
    const contract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    
    // Parse amount with correct decimals
    const amountWei = ethers.parseUnits(amount, decimals);
    
    // Send transaction
    const tx = await contract.transfer(to, amountWei);
    await tx.wait();
    
    return tx.hash;
  } catch (error: any) {
    console.error('Failed to send ERC20 transaction:', error);
    throw new Error(error.message || 'ERC20 transfer failed');
  }
}

/**
 * Send NFT (ERC721) transaction
 */
export async function sendNFTTransaction(
  privateKeyHex: string,
  contractAddress: string,
  to: string,
  tokenId: string,
  networkId?: string
): Promise<string> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const { ethers } = await import('ethers');
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`, provider);
    
    // ERC721 transferFrom function ABI
    const erc721Abi = ['function transferFrom(address from, address to, uint256 tokenId)'];
    const contract = new ethers.Contract(contractAddress, erc721Abi, wallet);
    
    // Send transaction
    const tx = await contract.transferFrom(wallet.address, to, tokenId);
    await tx.wait();
    
    return tx.hash;
  } catch (error: any) {
    console.error('Failed to send NFT transaction:', error);
    throw new Error(error.message || 'NFT transfer failed');
  }
}
