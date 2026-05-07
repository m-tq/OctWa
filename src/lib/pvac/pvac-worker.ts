/**
 * pvac-worker.ts — PVAC WASM Web Worker
 *
 * Runs all heavy PVAC crypto operations off the main thread so the UI
 * stays responsive during keygen, encrypt, proof generation, etc.
 *
 * Communication protocol:
 *   Main → Worker:  { id, op, payload }
 *   Worker → Main:  { id, type: 'progress', step, label, percent }
 *                   { id, type: 'result',   success, data?, error? }
 */

import type { PvacProgress } from './types'

// ─── Message types ────────────────────────────────────────────────────────────

export type WorkerOp =
  | 'decryptBalance'
  | 'encryptBalance'
  | 'decryptToPublic'
  | 'stealthSend'
  | 'stealthScan'
  | 'claimStealth'

export interface WorkerRequest {
  id: string
  op: WorkerOp
  payload: unknown
}

export interface WorkerProgressMessage {
  id: string
  type: 'progress'
  progress: PvacProgress
}

export interface WorkerResultMessage {
  id: string
  type: 'result'
  success: boolean
  data?: unknown
  error?: string
}

export type WorkerMessage = WorkerProgressMessage | WorkerResultMessage

// ─── Worker implementation ────────────────────────────────────────────────────

// Lazy-load ops inside the worker — avoids importing WASM on main thread
async function handleRequest(req: WorkerRequest): Promise<void> {
  const { id, op, payload } = req

  // Inject active RPC URL from main thread so makeRpcCall uses the correct network.
  // This is necessary because Web Workers cannot access localStorage.
  const raw = payload as Record<string, unknown>
  if (raw?._rpcUrl && typeof raw._rpcUrl === 'string') {
    ;(globalThis as Record<string, unknown>).__pvacWorkerRpcUrl = raw._rpcUrl
  }
  // Inject registration status from main thread (localStorage not available in workers)
  if (raw?._isRegistered === true) {
    ;(globalThis as Record<string, unknown>).__pvacIsRegistered = true
  } else {
    ;(globalThis as Record<string, unknown>).__pvacIsRegistered = false
  }

  const onProgress = (progress: PvacProgress) => {
    const msg: WorkerProgressMessage = { id, type: 'progress', progress }
    self.postMessage(msg)
  }

  try {
    let result: unknown

    switch (op) {
      case 'decryptBalance': {
        const { decryptBalance } = await import('./balance-ops')
        const input = payload as Parameters<typeof decryptBalance>[0]
        result = await decryptBalance(input, onProgress)
        break
      }
      case 'encryptBalance': {
        const { encryptBalance } = await import('./balance-ops')
        const raw = payload as Record<string, unknown>
        const fixedInput = { ...raw, amountRaw: BigInt(raw.amountRaw as string) } as Parameters<typeof encryptBalance>[0]
        result = await encryptBalance(fixedInput, onProgress)
        break
      }
      case 'decryptToPublic': {
        const { decryptToPublic } = await import('./balance-ops')
        const raw = payload as Record<string, unknown>
        const fixedInput = {
          ...raw,
          amountRaw: BigInt(raw.amountRaw as string),
        } as Parameters<typeof decryptToPublic>[0]
        result = await decryptToPublic(fixedInput, onProgress)
        break
      }
      case 'stealthSend': {
        const { stealthSend } = await import('./stealth-ops')
        const raw = payload as Record<string, unknown>
        const fixedInput = {
          ...raw,
          amountRaw: BigInt(raw.amountRaw as string),
        } as Parameters<typeof stealthSend>[0]
        result = await stealthSend(fixedInput, onProgress)
        break
      }
      case 'stealthScan': {
        const { stealthScan } = await import('./stealth-ops')
        const input = payload as Parameters<typeof stealthScan>[0]
        result = await stealthScan(input, onProgress)
        break
      }
      case 'claimStealth': {
        const { claimStealth } = await import('./stealth-ops')
        const input = payload as Parameters<typeof claimStealth>[0]
        result = await claimStealth(input, onProgress)
        break
      }
      default:
        throw new Error(`Unknown op: ${op}`)
    }

    // result is PvacResult<T> — spread its fields into the message
    const pvacResult = result as { success: boolean; data?: unknown; error?: string }
    const msg: WorkerResultMessage = {
      id,
      type: 'result',
      success: pvacResult.success,
      data: pvacResult.data,
      error: pvacResult.error,
    }
    self.postMessage(msg)
  } catch (error) {
    const msg: WorkerResultMessage = {
      id,
      type: 'result',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(msg)
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  handleRequest(event.data)
})
