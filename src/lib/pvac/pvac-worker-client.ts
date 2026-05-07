/**
 * pvac-worker-client.ts
 *
 * Singleton client that manages the PVAC Web Worker lifecycle and
 * provides a Promise-based API for calling worker operations.
 *
 * The worker is created lazily on first use and reused across calls.
 * Each call gets a unique ID so concurrent calls don't interfere.
 */

import type {
  WorkerOp,
  WorkerRequest,
  WorkerMessage,
  WorkerResultMessage,
} from './pvac-worker'
import type { PvacProgress, PvacResult } from './types'
import { getActiveRPCProvider } from '@/utils/rpc'
import { isPvacRegistered } from './node-registration'

// ─── Pending call registry ────────────────────────────────────────────────────

interface PendingCall {
  resolve: (result: WorkerResultMessage) => void
  reject: (error: Error) => void
  onProgress?: (progress: PvacProgress) => void
}

// ─── Worker singleton ─────────────────────────────────────────────────────────

let worker: Worker | null = null
const pending = new Map<string, PendingCall>()
let callCounter = 0

function getWorker(): Worker {
  if (worker) return worker

  // Vite handles ?worker imports — this creates a proper Web Worker
  worker = new Worker(new URL('./pvac-worker.ts', import.meta.url), {
    type: 'module',
  })

  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data
    const call = pending.get(msg.id)
    if (!call) return

    if (msg.type === 'progress') {
      call.onProgress?.(msg.progress)
    } else if (msg.type === 'result') {
      pending.delete(msg.id)
      call.resolve(msg)
    }
  })

  worker.addEventListener('error', (event) => {
    // Reject all pending calls on worker crash
    const error = new Error(`PVAC worker error: ${event.message}`)
    for (const [id, call] of pending) {
      pending.delete(id)
      call.reject(error)
    }
    // Reset worker so next call creates a fresh one
    worker = null
  })

  return worker
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a PVAC operation in the Web Worker.
 * Returns a PvacResult — never throws.
 */
export async function runInWorker<T>(
  op: WorkerOp,
  payload: unknown,
  onProgress?: (progress: PvacProgress) => void,
): Promise<PvacResult<T>> {
  const id = `pvac_${++callCounter}_${Date.now()}`

  return new Promise<PvacResult<T>>((resolve) => {
    const call: PendingCall = {
      onProgress,
      resolve: (msg) => resolve(msg as PvacResult<T>),
      reject: (error) => resolve({ success: false, error: error.message }),
    }

    pending.set(id, call)

    const req: WorkerRequest = {
      id,
      op,
      // Inject active RPC URL so worker uses the correct network (mainnet/devnet).
      // Also inject registration status so worker skips the 20s node check
      // when the wallet is already registered. Workers cannot access localStorage.
      payload: {
        ...(payload as Record<string, unknown>),
        _rpcUrl: getActiveRPCProvider()?.url ?? null,
        _isRegistered: (() => {
          const provider = getActiveRPCProvider()
          const address = (payload as Record<string, unknown>).address as string | undefined
          if (!address || !provider?.url) return false
          return isPvacRegistered(address, provider.url)
        })(),
      },
    }
    try {
      getWorker().postMessage(req)
    } catch (error) {
      pending.delete(id)
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Worker send failed',
      })
    }
  })
}

/** Terminate the worker (e.g., on wallet lock). */
export function terminatePvacWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  pending.clear()
}

/** Check if Web Workers are available in this environment. */
export function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined'
}
