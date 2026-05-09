/**
 * Response utilities for decoding data from extension messaging
 */

import type { InvocationResult, BalanceResponse } from './types';

/**
 * Decode response data from invoke() result
 * Handles various formats from Chrome extension messaging:
 * - Uint8Array (direct)
 * - Array of numbers
 * - Object with numeric keys {0: 123, 1: 34, ...}
 * - Already parsed object
 * 
 * @param result - InvocationResult from sdk.invoke()
 * @returns Parsed JSON object or null
 */
export function decodeResponseData<T = unknown>(result: InvocationResult): T | null {
  if (!result.success) {
    throw new Error(result.error || 'Invocation failed');
  }

  // Handle nested result structure from extension
  let responseData: unknown = result.data;
  const resultAny = result as unknown as { result?: { data?: unknown } };
  if (!responseData && resultAny.result?.data) {
    responseData = resultAny.result.data;
  }

  if (responseData === undefined || responseData === null) return null;

  // Convert to Uint8Array if needed
  let bytes: Uint8Array;

  if (responseData instanceof Uint8Array) {
    bytes = responseData;
  } else if (Array.isArray(responseData)) {
    bytes = new Uint8Array(responseData);
  } else if (typeof responseData === 'object' && responseData !== null) {
    const obj = responseData as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Empty object -> treat as null (common when the wallet echoes back an approved-
    // but-unhandled invocation with no payload; a stale extension build may do this
    // for newer SDK method names the current wallet version does not yet handle).
    if (keys.length === 0) return null;

    // Check if object has numeric keys (serialized Uint8Array)
    if (keys.every(k => /^\d+$/.test(k))) {
      const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));
      const arr = sortedKeys.map(k => obj[k] as number);
      bytes = new Uint8Array(arr);
    } else {
      // Already a parsed object with named keys
      return responseData as T;
    }
  } else {
    return responseData as T;
  }

  // Decode and parse JSON — empty buffer means the wallet returned nothing.
  if (bytes.length === 0) return null;

  const decoded = new TextDecoder().decode(bytes);
  const trimmed = decoded.trim();
  if (trimmed.length === 0) return null;

  try {
    return JSON.parse(decoded) as T;
  } catch (err) {
    throw new Error(
      `Invocation returned non-JSON payload (first 40 chars: ${JSON.stringify(decoded.slice(0, 40))}): ` +
      (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * Decode balance response from get_balance invoke result.
 * Returns full balance including encrypted balance info.
 */
export function decodeBalanceResponse(result: InvocationResult): BalanceResponse {
  const data = decodeResponseData<BalanceResponse>(result);
  if (!data) throw new Error('Empty balance response');

  // Ensure backward-compatible defaults for fields added in Phase 2
  return {
    octAddress:        data.octAddress,
    octBalance:        data.octBalance ?? 0,
    encryptedBalance:  data.encryptedBalance ?? 0,
    cipher:            data.cipher ?? '0',
    hasPvacPubkey:     data.hasPvacPubkey ?? false,
    network:           data.network ?? 'mainnet',
  };
}
