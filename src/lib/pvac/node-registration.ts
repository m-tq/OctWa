/**
 * PVAC pubkey registration on the Octra node.
 *
 * The node rejects encrypt/decrypt/stealth transactions from wallets that
 * haven't registered their PVAC public key. This module handles the
 * check-and-register flow directly from the browser, without the native server.
 *
 * Registration is cached per (address + network) so we don't re-check on
 * every operation within the same session. Cache is invalidated on network switch.
 *
 * Mirrors ensure_pvac_registered_on_node() in pvac_ops.hpp.
 */

import { makeRpcCall } from '@/services/rpcHelper'
import { getActiveRPCProvider } from '@/utils/rpc'
import { signRegisterRequest, decodeBase64 } from './crypto-utils'
import type { PvacWasm } from '../../../pvac_server/wasm/pvac-wasm'

// ─── Direct registration (bypasses proxy size limits) ────────────────────────

/**
 * Send octra_registerPvacPubkey directly to the node URL, bypassing any
 * reverse proxy (Vite dev proxy, nginx) that may have a body size limit.
 * The PVAC pubkey payload is ~3MB which exceeds default proxy limits (413).
 */
async function registerDirectly(
  nodeUrl: string,
  address: string,
  pvacPubkeyB64: string,
  regSig: string,
  walletPubB64: string,
  aesKat: string,
): Promise<unknown> {
  const rpcUrl = nodeUrl.replace(/\/$/, '') + '/rpc'

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'octra_registerPvacPubkey',
    params: [address, pvacPubkeyB64, regSig, walletPubB64, aesKat],
  })

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      console.warn(`[pvac-registration] Direct POST failed: HTTP ${response.status}`)
      return null
    }

    const data = await response.json()
    if (data.error) {
      const msg = data.error.message ?? data.error
      if (typeof msg === 'string' && msg.includes('already registered')) return 'already_registered'
      console.warn(`[pvac-registration] RPC error:`, msg)
      return null
    }

    return data.result ?? true
  } catch (err) {
    console.warn(`[pvac-registration] Direct POST error:`, err)
    return null
  }
}

export interface RegistrationResult {
  success: boolean
  alreadyRegistered?: boolean
  error?: string
}

// ─── Persistent registration cache ───────────────────────────────────────────
// Registration is once-per-wallet-per-network on-chain.
// We persist this in localStorage so it survives page reloads and extension
// restarts — no need to re-check the node on every operation.
//
// Key: `pvac_reg:${address}:${networkUrl}`
// Workers cannot access localStorage, so the main thread injects the
// registration status via `_isRegistered` in the worker payload
// (same pattern as `_rpcUrl`).

const STORAGE_KEY_PREFIX = 'pvac_reg:'

/** In-memory cache for the current worker/main-thread context. */
const memoryCache = new Map<string, boolean>()

function getCacheKey(address: string): string {
  const workerUrl = (globalThis as Record<string, unknown>).__pvacWorkerRpcUrl as string | undefined
  if (workerUrl) return `${address}:${workerUrl}`
  const provider = getActiveRPCProvider()
  return `${address}:${provider?.url ?? 'default'}`
}

function isRegisteredPersisted(cacheKey: string): boolean {
  if (memoryCache.get(cacheKey)) return true
  // Check worker-injected flag first (fastest path in worker context)
  const injected = (globalThis as Record<string, unknown>).__pvacIsRegistered
  if (injected === true) return true
  // Fall back to localStorage (main thread only)
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY_PREFIX + cacheKey) === '1'
    }
  } catch { /* ignore */ }
  return false
}

function markRegisteredPersisted(cacheKey: string): void {
  memoryCache.set(cacheKey, true)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_PREFIX + cacheKey, '1')
    }
  } catch { /* ignore */ }
}

/**
 * Check if this wallet+network is already registered (for use in main thread
 * before dispatching to worker).
 */
export function isPvacRegistered(address: string, networkUrl: string): boolean {
  const key = `${address}:${networkUrl}`
  if (memoryCache.get(key)) return true
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY_PREFIX + key) === '1'
    }
  } catch { /* ignore */ }
  return false
}

/** Clear registration cache (call on wallet switch or network switch). */
export function clearRegistrationCache(): void {
  memoryCache.clear()
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(STORAGE_KEY_PREFIX)) keysToRemove.push(k)
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k))
    }
  } catch { /* ignore */ }
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Ensure the wallet's PVAC pubkey is registered on the active network node.
 * Safe to call before every operation — idempotent and cached per session.
 *
 * Automatically follows the active RPC provider (mainnet/devnet/custom).
 */
export async function ensurePvacRegisteredOnNode(
  pvac: PvacWasm,
  address: string,
  sk64: Uint8Array,
  publicKeyB64: string,
): Promise<RegistrationResult> {
  const cacheKey = getCacheKey(address)

  // Fast path: already confirmed registered (memory, localStorage, or worker-injected flag)
  if (isRegisteredPersisted(cacheKey)) {
    return { success: true, alreadyRegistered: true }
  }

  try {
    const pvacPubkeyB64 = pvac.getPubkeyB64()
    const pvacPubkeyBytes = decodeBase64(pvacPubkeyB64)

    const workerUrl = (globalThis as Record<string, unknown>).__pvacWorkerRpcUrl as string | undefined
    const networkUrl = workerUrl ?? getActiveRPCProvider()?.url ?? 'unknown'

    // Check if already registered on the active network
    const checkResult = await makeRpcCall('octra_pvacPubkey', [address])

    if (
      checkResult &&
      typeof checkResult === 'object' &&
      'pvac_pubkey' in checkResult &&
      checkResult.pvac_pubkey === pvacPubkeyB64
    ) {
      markRegisteredPersisted(cacheKey)
      return { success: true, alreadyRegistered: true }
    }

    // Not registered — register now on the active network
    const regSig = await signRegisterRequest(address, pvacPubkeyBytes, sk64)
    const aesKat = pvac.aesKat()

    const regResult = await registerDirectly(networkUrl, address, pvacPubkeyB64, regSig, publicKeyB64, aesKat)

    if (regResult === 'already_registered' || (regResult !== null && regResult !== undefined)) {
      markRegisteredPersisted(cacheKey)
      return { success: true, alreadyRegistered: regResult === 'already_registered' }
    }

    return { success: false, error: 'Registration returned no result' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message.includes('already registered') || message.includes('already_registered')) {
      markRegisteredPersisted(cacheKey)
      return { success: true, alreadyRegistered: true }
    }

    console.error(`[pvac-registration] Registration failed:`, message)
    return { success: false, error: message }
  }
}
