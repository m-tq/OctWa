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
function getStoredEVMProviders(): Record<string, string> {
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
  } catch {
    // Ignore
  }
  return DEFAULT_EVM_NETWORKS[0];
}

/**
 * Set active EVM network
 */
export function setActiveEVMNetwork(networkId: string): void {
  localStorage.setItem(ACTIVE_EVM_NETWORK_KEY, networkId);
  
  // Sync to chrome.storage for background script access
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ [ACTIVE_EVM_NETWORK_KEY]: networkId }).catch(() => {
      // Ignore errors in non-extension context
    });
  }
}

/**
/**
 * Make JSON-RPC call
 */
async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
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
    const balanceHex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']) as string;
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
    ]) as string;
    
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
    ]) as [string, string, string];
    
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
 * Get gas price
 */
export async function getEVMGasPrice(networkId?: string): Promise<string> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const gasPriceHex = await rpcCall(rpcUrl, 'eth_gasPrice', []) as string;
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
  logo?: string; // data URI or URL for token icon
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

// wOCT logo — inline SVG data URI
const WOCT_LOGO = `data:image/svg+xml,%3Csvg width='50' height='50' viewBox='0 0 50 50' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='25' cy='25' r='21' stroke='%230000DB' stroke-width='8'/%3E%3C/svg%3E`;

// Common ERC20 tokens per chain
export const COMMON_TOKENS: Record<number, Array<{ address: string; name: string; symbol: string; decimals: number; logo?: string }>> = {
  1: [ // Ethereum
    { address: '0x4647e1fe715c9e23959022c2416c71867f5a6e80', name: 'Wrapped OCT', symbol: 'wOCT', decimals: 6, logo: WOCT_LOGO },
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
    ]) as [string, string, string];
    
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
    
    const result = await rpcCall(rpcUrl, 'eth_call', [{ to: contractAddress, data }, 'latest']) as string;
    
    const owner = '0x' + result.slice(-40);
    return owner.toLowerCase() === walletAddress.toLowerCase();
  } catch (error) {
    console.error('Failed to check NFT ownership:', error);
    return false;
  }
}

/**
 * Get recent transactions (using Etherscan API V2)
 */
async function getEVMTransactions(
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
    
    return data.result.map((tx: Record<string, unknown>) => ({
      hash: tx.hash as string,
      from: tx.from as string,
      to: (tx.to as string) || '',
      value: (Number(tx.value) / 1e18).toFixed(6),
      timestamp: Number(tx.timeStamp) * 1000,
      status: tx.isError === '0' ? 'confirmed' : 'confirmed',
      type: (tx.from as string).toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
    }));
  } catch (error) {
    console.error('Failed to fetch ETH transactions:', error);
    return [];
  }
}

/**
 * Get ERC20 token transfer history for specific tokens (using Etherscan API V2)
 * @param address - Wallet address
 * @param tokenAddresses - Array of ERC20 token contract addresses to filter
 * @param networkId - Network ID (optional)
 */
async function getERC20Transactions(
  address: string,
  tokenAddresses: string[] = [],
  networkId?: string
): Promise<EVMTransaction[]> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
  
  try {
    // Fetch ALL ERC-20 transfers for this address (no token filter)
    const url = `https://api.etherscan.io/v2/api?chainid=${network.chainId}&module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc${apiKey ? `&apikey=${apiKey}` : ''}`;
    
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = await response.json();
    
    if (data.status === '0') return []; // No transactions found
    if (!Array.isArray(data.result)) return [];
    
    // If specific token addresses provided, filter to those; otherwise return all
    const lowerTokenAddresses = tokenAddresses.map(a => a.toLowerCase());
    const txList = tokenAddresses.length > 0
      ? data.result.filter((tx: Record<string, unknown>) => lowerTokenAddresses.includes((tx.contractAddress as string)?.toLowerCase()))
      : data.result;
    
    return txList.map((tx: Record<string, unknown>) => {
      const decimals = parseInt(tx.tokenDecimal as string) || 18;
      const value = (Number(tx.value) / Math.pow(10, decimals)).toFixed(6);
      return {
        hash: tx.hash as string,
        from: tx.from as string,
        to: (tx.to as string) || '',
        value,
        timestamp: Number(tx.timeStamp) * 1000,
        status: 'confirmed' as const,
        type: (tx.from as string).toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
        tokenSymbol: (tx.tokenSymbol as string) || 'TOKEN',
        tokenAddress: tx.contractAddress as string,
      };
    });
  } catch (error) {
    console.error('Failed to fetch ERC20 transactions:', error);
    return [];
  }
}

/**
 * Get all EVM transactions including ERC20 token transfers for imported tokens
 * @param address - Wallet address
 * @param customTokenAddresses - Array of custom/imported token addresses
 * @param networkId - Network ID (optional)
 */
export async function getAllEVMTransactions(
  address: string,
  _customTokenAddresses: string[] = [],
  networkId?: string
): Promise<EVMTransaction[]> {
  try {
    const [nativeTxs, erc20Txs] = await Promise.all([
      getEVMTransactions(address, networkId),
      getERC20Transactions(address, [], networkId),
    ]);

    // Build a map of ERC-20 txs by hash (one entry per hash — last token transfer wins)
    const erc20ByHash = new Map<string, EVMTransaction>();
    for (const tx of erc20Txs) {
      erc20ByHash.set(tx.hash.toLowerCase(), tx);
    }

    const result: EVMTransaction[] = [];
    const seenHashes = new Set<string>();

    for (const nativeTx of nativeTxs) {
      const key = nativeTx.hash.toLowerCase();
      seenHashes.add(key);
      const erc20Match = erc20ByHash.get(key);

      if (erc20Match && parseFloat(nativeTx.value) === 0) {
        // Zero-value native tx = pure token transfer — show the ERC-20 entry
        result.push(erc20Match);
      } else if (erc20Match && parseFloat(nativeTx.value) > 0) {
        // Real ETH transfer that also moved tokens — show both
        result.push(nativeTx);
        result.push({ ...erc20Match, hash: erc20Match.hash + '_erc20' });
      } else {
        // Native-only tx (no token transfer)
        result.push(nativeTx);
      }
    }

    // Add ERC-20 txs whose hash didn't appear in native list at all
    for (const erc20Tx of erc20Txs) {
      if (!seenHashes.has(erc20Tx.hash.toLowerCase())) {
        result.push(erc20Tx);
      }
    }

    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  } catch (error) {
    console.error('Failed to fetch all EVM transactions:', error);
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
  data?: string,
  gasOverrides?: { gasLimit?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
): Promise<string> {
  const network = networkId 
    ? getAllNetworks().find(n => n.id === networkId) || getActiveEVMNetwork()
    : getActiveEVMNetwork();
  
  const rpcUrl = getEVMRpcUrl(network.id);
  
  try {
    const { ethers } = await import('ethers');
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`, provider);
    
    const amountWei = ethers.parseEther(amountEth);
    
    const txRequest: { to: string; value: bigint; data?: string; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; type?: number; gasLimit?: bigint } = {
      to,
      value: amountWei,
    };
    
    if (data) {
      txRequest.data = data.startsWith('0x') ? data : `0x${data}`;
    }

    // EIP-1559: fetch current base fee, use minimal tip
    try {
      const feeData = await provider.getFeeData()
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        const minTip = ethers.parseUnits('0.1', 'gwei')
        const baseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas
        txRequest.type = 2
        txRequest.maxPriorityFeePerGas = gasOverrides?.maxPriorityFeePerGas ?? minTip
        txRequest.maxFeePerGas = gasOverrides?.maxFeePerGas ?? (baseFee * 110n / 100n + minTip)
      }
    } catch {
      // fallback: let ethers auto-estimate fees
    }

    // Gas limit: user override → dynamic estimate → fallback to known actual usage
    if (gasOverrides?.gasLimit) {
      txRequest.gasLimit = gasOverrides.gasLimit
    } else {
      try {
        const estimated = await provider.estimateGas({ ...txRequest, from: wallet.address })
        txRequest.gasLimit = estimated * 110n / 100n
      } catch {
        txRequest.gasLimit = 150_000n  // default from successful bridge tx
      }
    }
    
    const tx = await wallet.sendTransaction(txRequest);
    // Don't wait for confirmation — return hash immediately so popup can close
    // Caller is responsible for tracking confirmation status
    return tx.hash;
  } catch (error) {
    console.error('Failed to send transaction:', error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('gas required exceeds allowance') || msg.includes('insufficient funds')) {
      throw new Error(
        `Insufficient ETH for gas fees. Please top up your EVM address to at least 0.002 ETH to cover gas costs.`
      )
    }
    throw new Error(msg || 'Transaction failed');
  }
}

/**
 * Send ERC20 token transaction
 * @param privateKeyHex - Private key in hex format
 * @param tokenAddress - ERC20 contract address
 * @param to - Recipient address
 * @param amount - Amount in smallest units (e.g., for USDC with 6 decimals, 1000000 = 1 USDC)
 * @param networkId - Network ID (optional, defaults to active network)
 */
export async function sendERC20Transaction(
  privateKeyHex: string,
  tokenAddress: string,
  to: string,
  amount: string,
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
    
    // Amount is already in smallest units (e.g., 1000000 for 1 USDC)
    const amountBigInt = BigInt(amount);
    
    // Send transaction
    const tx = await contract.transfer(to, amountBigInt);
    await tx.wait();
    
    return tx.hash;
  } catch (error) {
    console.error('Failed to send ERC20 transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'ERC20 transfer failed');
  }
}

export async function sendNFTTransaction(
  privateKeyHex: string,
  contractAddress: string,
  to: string,
  tokenId: string,
  networkId?: string,
): Promise<string> {
  const network = networkId
    ? getAllNetworks().find((n) => n.id === networkId) ?? getActiveEVMNetwork()
    : getActiveEVMNetwork();

  const rpcUrl = getEVMRpcUrl(network.id);

  try {
    const { JsonRpcProvider, Wallet, Contract } = await import('ethers');

    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(
      privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`,
      provider,
    );

    const erc721Abi = ['function transferFrom(address from, address to, uint256 tokenId)'];
    const contract = new Contract(contractAddress, erc721Abi, wallet);

    const tx = await contract.transferFrom(wallet.address, to, tokenId);
    await tx.wait();

    return tx.hash;
  } catch (error) {
    console.error('Failed to send NFT transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'NFT transfer failed');
  }
}
