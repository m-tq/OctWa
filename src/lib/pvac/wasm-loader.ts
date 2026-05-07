/**
 * PVAC WASM module loader with singleton lifecycle.
 *
 * The WASM binary is large (~650KB) and keygen is expensive (~1-3s).
 * This module caches the loaded instance and the derived keypair so
 * subsequent operations within the same session are fast.
 */

import { PvacWasm } from '../../../pvac_server/wasm/pvac-wasm'
import { deriveSeed32 } from './crypto-utils'

// ─── Singleton state ──────────────────────────────────────────────────────────

let wasmInstance: PvacWasm | null = null
let moduleLoaded = false
let loadPromise: Promise<void> | null = null

/** Cached seed to detect when re-keygen is needed. */
let cachedSeedB64: string | null = null

// ─── Module loading ───────────────────────────────────────────────────────────

async function loadWasmModule(): Promise<void> {
  if (moduleLoaded) return

  if (loadPromise) {
    await loadPromise
    return
  }

  loadPromise = (async () => {
    // Dynamic import — Vite will code-split this into a separate chunk
    const { default: PvacModule } = await import(
      /* webpackChunkName: "pvac-wasm" */
      '../../../pvac_server/build-wasm/pvac_wasm.mjs'
    )

    wasmInstance = new PvacWasm()
    await wasmInstance.load(PvacModule)
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
