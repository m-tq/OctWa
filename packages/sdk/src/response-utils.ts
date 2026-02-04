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

  if (!responseData) return null;

  // Convert to Uint8Array if needed
  let bytes: Uint8Array;

  if (responseData instanceof Uint8Array) {
    bytes = responseData;
  } else if (Array.isArray(responseData)) {
    bytes = new Uint8Array(responseData);
  } else if (typeof responseData === 'object' && responseData !== null) {
    const obj = responseData as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Check if object has numeric keys (serialized Uint8Array)
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
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

  // Decode and parse JSON
  const decoded = new TextDecoder().decode(bytes);
  return JSON.parse(decoded) as T;
}

/**
 * Decode balance response from get_balance invoke result
 * 
 * @param result - InvocationResult from sdk.invoke() with method 'get_balance'
 * @returns BalanceResponse object
 */
export function decodeBalanceResponse(result: InvocationResult): BalanceResponse {
  const data = decodeResponseData<BalanceResponse>(result);
  if (!data) {
    throw new Error('Empty balance response');
  }
  return data;
}
