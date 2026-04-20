/**
 * rpcHelper — thin JSON-RPC 2.0 wrapper
 *
 * Handles extension / dev / prod routing identically to makeAPIRequest in api.ts,
 * but lives in src/services/ so encryptedBalanceService can import it without
 * creating a circular dependency with src/utils/api.ts.
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

/**
 * Build the correct fetch URL for the /rpc endpoint, matching api.ts routing:
 *   - Extension  → direct: {providerUrl}/rpc
 *   - Dev        → Vite proxy: /api/rpc  (+ X-RPC-URL header)
 *   - Production → nginx proxy: /rpc-proxy/rpc  (+ X-RPC-Target header)
 */
function buildRpcUrl(providerUrl: string): { url: string; extraHeaders: Record<string, string> } {
  if (isExtensionContext()) {
    return { url: `${providerUrl}/rpc`, extraHeaders: {} };
  }
  if (isDevelopmentMode()) {
    return { url: '/api/rpc', extraHeaders: { 'X-RPC-URL': providerUrl } };
  }
  return { url: '/rpc-proxy/rpc', extraHeaders: { 'X-RPC-Target': providerUrl } };
}

/**
 * Execute a JSON-RPC 2.0 call and return the `result` field.
 * Returns null on any error (network, RPC error, parse error).
 */
export async function makeRpcCall(
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const provider = getActiveRPCProvider();
  if (!provider) {
    console.warn('[rpcHelper] No active RPC provider');
    return null;
  }

  const { url, extraHeaders } = buildRpcUrl(provider.url);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id: Date.now(),
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body,
      // Increased timeout for large stealth output lists
      signal: AbortSignal.timeout(60_000), // 60 seconds
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
    console.warn(`[rpcHelper] Request failed for ${method}:`, err);
    return null;
  }
}
