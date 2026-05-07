/**
 * RPC URL override for Web Worker context.
 *
 * Web Workers cannot access localStorage, so getActiveRPCProvider() always
 * returns the default mainnet URL. This module allows the main thread to
 * inject the active RPC URL into the worker before each operation.
 *
 * Usage in worker:
 *   setWorkerRpcUrl(payload._rpcUrl)
 *
 * Usage in rpcHelper (worker context):
 *   getWorkerRpcUrl() → overrides getActiveRPCProvider()
 */

let workerRpcUrl: string | null = null

export function setWorkerRpcUrl(url: string | null): void {
  workerRpcUrl = url
}

export function getWorkerRpcUrl(): string | null {
  return workerRpcUrl
}
