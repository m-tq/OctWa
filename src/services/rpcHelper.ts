/**
 * Thin JSON-RPC 2.0 wrapper for the Octra node.
 *
 * Mirrors the routing logic in api.ts (extension → direct, dev → Vite proxy,
 * prod → nginx proxy) without creating a circular dependency.
 *
 * In Web Worker context, localStorage is unavailable so getActiveRPCProvider()
 * returns the default mainnet URL. The worker injects the active RPC URL via
 * rpc-override.ts before each operation to ensure the correct network is used.
 */

import { getActiveRPCProvider } from '../utils/rpc';

function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome.runtime &&
    typeof chrome.runtime.id === 'string' &&
    chrome.runtime.id.length > 0
  );
}

function isDevelopmentMode(): boolean {
  return import.meta.env.DEV === true;
}

function buildRpcUrl(providerUrl: string): { url: string; extraHeaders: Record<string, string> } {
  // In worker context, always use direct URL (no proxy available)
  if (typeof window === 'undefined') return { url: `${providerUrl}/rpc`, extraHeaders: {} };
  // If providerUrl is an absolute URL (http/https), always use it directly.
  // This covers extension popup, expanded view, and any context where the
  // provider URL is a direct node address.
  if (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')) {
    return { url: `${providerUrl}/rpc`, extraHeaders: {} };
  }
  if (isExtensionContext()) return { url: `${providerUrl}/rpc`, extraHeaders: {} };
  if (isDevelopmentMode()) return { url: '/api/rpc', extraHeaders: { 'X-RPC-URL': providerUrl } };
  return { url: '/rpc-proxy/rpc', extraHeaders: { 'X-RPC-Target': providerUrl } };
}

/** Get the active RPC provider URL, respecting worker override if set. */
function getActiveProviderUrl(): string | null {
  // Check for worker-injected RPC URL override (set before each worker operation)
  try {
    const override = (globalThis as Record<string, unknown>).__pvacWorkerRpcUrl as string | undefined;
    if (override) {
      return override;
    }
  } catch { /* ignore */ }

  const provider = getActiveRPCProvider();
  return provider?.url ?? null;
}

/**
 * Per-method timeout overrides (ms).
 * Methods that scan the full chain need a much longer budget than simple queries.
 */
const METHOD_TIMEOUTS: Record<string, number> = {
  // Full-chain scan — can be slow on large networks
  octra_stealthOutputs: 120_000,
};

const DEFAULT_TIMEOUT_MS = 30_000;

/** Execute a JSON-RPC 2.0 call and return the `result` field, or null on any error. */
export async function makeRpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const providerUrl = getActiveProviderUrl();
  if (!providerUrl) {
    console.warn('[rpcHelper] No active RPC provider');
    return null;
  }

  const { url, extraHeaders } = buildRpcUrl(providerUrl);
  const timeoutMs = METHOD_TIMEOUTS[method] ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.warn(`[rpcHelper] HTTP ${response.status} for ${method}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.warn(`[rpcHelper] RPC error for ${method}:`, data.error.message ?? data.error);
      return null;
    }

    return data.result ?? null;
  } catch (err) {
    // Improve DOMException logging — show the actual error name/message
    const label = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[rpcHelper] Request failed for ${method}:`, label);
    return null;
  }
}
