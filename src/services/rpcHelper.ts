/**
 * Thin JSON-RPC 2.0 wrapper for the Octra node.
 *
 * Mirrors the routing logic in api.ts (extension → direct, dev → Vite proxy,
 * prod → nginx proxy) without creating a circular dependency.
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
  if (isExtensionContext()) return { url: `${providerUrl}/rpc`, extraHeaders: {} };
  if (isDevelopmentMode()) return { url: '/api/rpc', extraHeaders: { 'X-RPC-URL': providerUrl } };
  return { url: '/rpc-proxy/rpc', extraHeaders: { 'X-RPC-Target': providerUrl } };
}

/** Execute a JSON-RPC 2.0 call and return the `result` field, or null on any error. */
export async function makeRpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const provider = getActiveRPCProvider();
  if (!provider) {
    console.warn('[rpcHelper] No active RPC provider');
    return null;
  }

  const { url, extraHeaders } = buildRpcUrl(provider.url);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
      signal: AbortSignal.timeout(300_000),
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
