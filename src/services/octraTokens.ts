/**
 * Octra OCS01 Token Service
 *
 * Uses the fast `octra_tokensByAddress` RPC endpoint (0.03–0.06s) to fetch
 * all OCS01 tokens held by a wallet. Falls back to manual contract_call
 * lookups for individual token metadata when needed (e.g. "Add Token" flow).
 *
 * Token transfer uses op_type="call", method="transfer", params=[to, amount].
 */

import { getActiveRPCProvider } from '../utils/rpc';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OctraToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;       // raw units as string
  totalSupply?: string;  // raw units
  owner?: string;
}

export interface TokenTransferResult {
  hash: string;
  nonce: number;
}

// ─── RPC Helper ──────────────────────────────────────────────────────────────

function getRpcUrl(): string {
  const provider = getActiveRPCProvider();
  return (provider?.url ?? 'http://46.101.86.250:8080').replace(/\/$/, '');
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(`${getRpcUrl()}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result as T;
}

// ─── Token List (fast endpoint) ──────────────────────────────────────────────

/**
 * Fetch all OCS01 tokens for an address using the new fast endpoint.
 * Response shape (from webcli reference):
 *   { tokens: [{ address, name, symbol, total_supply, balance, decimals, owner }], count, wallet_address }
 */
export async function fetchTokensByAddress(walletAddress: string): Promise<OctraToken[]> {
  try {
    const result = await rpc<{
      tokens?: Array<{
        address: string;
        name: string;
        symbol: string;
        total_supply?: string;
        balance?: string;
        decimals?: string | number;
        owner?: string;
      }>;
      count?: number;
    }>('octra_tokensByAddress', [walletAddress]);

    if (!result?.tokens || !Array.isArray(result.tokens)) return [];

    return result.tokens.map(t => ({
      address: t.address,
      name: t.name || t.symbol || 'Unknown',
      symbol: t.symbol || '???',
      decimals: typeof t.decimals === 'number' ? t.decimals : parseInt(String(t.decimals || '0'), 10),
      balance: String(t.balance || '0'),
      totalSupply: t.total_supply ? String(t.total_supply) : undefined,
      owner: t.owner,
    }));
  } catch (err) {
    console.warn('[OctraTokens] octra_tokensByAddress failed, trying fallback:', err);
    // If the new endpoint isn't available yet, return empty — don't fall back
    // to the slow listContracts path in the wallet (that's 30s+).
    return [];
  }
}

// ─── Single Token Lookup (for "Add Token" by address) ────────────────────────

export async function lookupToken(
  contractAddress: string,
  walletAddress: string,
): Promise<OctraToken | null> {
  try {
    const [nameRes, symbolRes, decimalsRes, balanceRes, supplyRes] = await Promise.allSettled([
      rpc<{ result?: string }>('contract_call', [contractAddress, 'get_name', [], walletAddress]),
      rpc<{ result?: string }>('contract_call', [contractAddress, 'get_symbol', [], walletAddress]),
      rpc<{ result?: string }>('contract_call', [contractAddress, 'decimals', [], walletAddress]),
      rpc<{ result?: string }>('contract_call', [contractAddress, 'balance_of', [walletAddress], walletAddress]),
      rpc<{ result?: string }>('contract_call', [contractAddress, 'get_total_supply', [], walletAddress]),
    ]);

    const name = nameRes.status === 'fulfilled' ? (nameRes.value?.result || '') : '';
    const symbol = symbolRes.status === 'fulfilled' ? (symbolRes.value?.result || '') : '';
    const decimals = decimalsRes.status === 'fulfilled' ? parseInt(String(decimalsRes.value?.result || '0'), 10) : 0;
    const balance = balanceRes.status === 'fulfilled' ? String(balanceRes.value?.result || '0') : '0';
    const totalSupply = supplyRes.status === 'fulfilled' ? String(supplyRes.value?.result || '0') : '0';

    if (!symbol && !name) return null; // Not a valid OCS01 token

    return {
      address: contractAddress,
      name: name || symbol || 'Unknown',
      symbol: symbol || '???',
      decimals,
      balance,
      totalSupply,
    };
  } catch {
    return null;
  }
}

// ─── Refresh single token balance ────────────────────────────────────────────

export async function refreshTokenBalance(
  contractAddress: string,
  walletAddress: string,
): Promise<string> {
  try {
    const res = await rpc<{ result?: string }>(
      'contract_call',
      [contractAddress, 'balance_of', [walletAddress], walletAddress],
    );
    return String(res?.result || '0');
  } catch {
    return '0';
  }
}

// ─── Format token amount ─────────────────────────────────────────────────────

export function formatTokenAmount(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0';
  const num = BigInt(raw);
  if (decimals === 0) return num.toString();
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const frac = num % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/**
 * Convert a human-readable amount to raw units for a given decimal count.
 * E.g. "1.5" with decimals=6 → "1500000"
 */
export function toTokenRawUnits(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0';
  const parts = amount.split('.');
  const whole = parts[0] || '0';
  let frac = parts[1] || '';
  if (frac.length > decimals) frac = frac.slice(0, decimals);
  frac = frac.padEnd(decimals, '0');
  const raw = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return raw.toString();
}
