/**
 * PVAC WASM module loader with singleton lifecycle.
 *
 * The WASM binary is large (~650KB) and keygen is expensive (~1-3s).
 * This module caches the loaded instance and the derived keypair so
 * subsequent operations within the same session are fast.
 *
 * Two flavours are shipped under `./wasm-runtime/build/`:
 *   - `pvac_wasm.{mjs,wasm}`     — single-thread fallback (always works)
 *   - `pvac_wasm_mt.{mjs,wasm}`  — pthread + SIMD-128, ~2.4× faster on
 *                                   range proofs. Requires the host page
 *                                   to be cross-origin isolated
 *                                   (COOP `same-origin` + COEP
 *                                   `require-corp`) so SharedArrayBuffer
 *                                   is available.
 *
 * The loader tries MT first when the environment supports it and silently
 * falls back to ST otherwise. The single-thread build remains fully
 * functional — only proof generation is slower.
 */

import { PvacWasm } from './wasm-runtime/pvac-wasm'
import { deriveSeed32 } from './crypto-utils'

// ─── Singleton state ──────────────────────────────────────────────────────────

let wasmInstance: PvacWasm | null = null
let moduleLoaded = false
let loadPromise: Promise<void> | null = null

/** Cached seed to detect when re-keygen is needed. */
let cachedSeedB64: string | null = null

// ─── Module loading ───────────────────────────────────────────────────────────

/**
 * Detect whether this context can run the multi-thread build.
 * Requires SharedArrayBuffer + crossOriginIsolated. Both flags must
 * already be set by the host page; we never try to coerce them here.
 */
function canUseMultiThread(): boolean {
  try {
    const g = globalThis as typeof globalThis & {
      crossOriginIsolated?: boolean
      SharedArrayBuffer?: unknown
    }
    return (
      typeof g.SharedArrayBuffer === 'function' &&
      g.crossOriginIsolated === true
    )
  } catch {
    return false
  }
}

async function loadWasmModule(): Promise<void> {
  if (moduleLoaded) return

  if (loadPromise) {
    await loadPromise
    return
  }

  loadPromise = (async () => {
    const useMt = canUseMultiThread()
    let factory: ((opts?: object) => Promise<unknown>) | null = null

    if (useMt) {
      try {
        const mt = await import(
          /* webpackChunkName: "pvac-wasm-mt" */
          './wasm-runtime/build/pvac_wasm_mt.mjs'
        )
        factory = (mt as { default: (opts?: object) => Promise<unknown> }).default
      } catch (err) {
        // MT module missing or failed to instantiate (e.g. blocked worker
        // bundling) — fall through to single-thread.
        console.warn('[pvac] MT build unavailable, using single-thread:', err)
      }
    }

    if (!factory) {
      const st = await import(
        /* webpackChunkName: "pvac-wasm" */
        './wasm-runtime/build/pvac_wasm.mjs'
      )
      factory = (st as { default: (opts?: object) => Promise<unknown> }).default
    }

    wasmInstance = new PvacWasm()
    await wasmInstance.load(factory as Parameters<PvacWasm['load']>[0])
    moduleLoaded = true
  })()

  await loadPromise
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a ready-to-use PvacWasm instance initialized with the given private key.
 * Caches the instance — re-keygen only happens when the private key changes.
 */
export async function getPvacWasm(privateKeyB64: string): Promise<PvacWasm> {
  await loadWasmModule()

  if (!wasmInstance) throw new Error('PVAC WASM failed to load')

  const seed = deriveSeed32(privateKeyB64)
  const seedB64 = btoa(String.fromCharCode(...seed))

  if (cachedSeedB64 !== seedB64) {
    wasmInstance.init(seed)
    cachedSeedB64 = seedB64
  }

  return wasmInstance
}

/** Check if the WASM module is available (build output exists). */
export async function isWasmAvailable(): Promise<boolean> {
  try {
    await loadWasmModule()
    return true
  } catch {
    return false
  }
}

/** Release the cached keypair (e.g., on wallet lock). */
export function releasePvacWasm(): void {
  wasmInstance?.reset()
  cachedSeedB64 = null
}
