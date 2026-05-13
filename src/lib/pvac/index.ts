/**
 * Browser-based PVAC crypto engine — public API.
 *
 * Main-thread consumers only see types and the worker client. Everything that
 * touches the WASM module (wasm-loader, balance-ops, stealth-ops) is loaded
 * from inside the worker and must never appear in the main-thread bundle.
 *
 * ⚠ Do NOT `export *` from `./balance-ops`, `./stealth-ops`, or `./wasm-loader`
 *   here — doing so pulls the Emscripten loader (~40 KB) and the 536 KB WASM
 *   binary into any main-thread chunk that imports this barrel.
 */

export * from './types'
export { runInWorker, isWorkerAvailable, terminatePvacWorker } from './pvac-worker-client'
export type { WorkerOp } from './pvac-worker'
