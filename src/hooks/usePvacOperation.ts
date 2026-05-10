/**
 * React hook for running PVAC crypto operations with progress tracking,
 * realtime log entries, and elapsed time.
 *
 * Offloads work to a Web Worker so the UI stays responsive.
 * Falls back to main-thread execution if Workers are unavailable.
 */

import { useState, useCallback, useRef } from 'react'
import type { PvacProgress, PvacProgressCallback, PvacResult } from '@/lib/pvac/types'
import { runInWorker, isWorkerAvailable } from '@/lib/pvac/pvac-worker-client'
import type { WorkerOp } from '@/lib/pvac/pvac-worker'

// ─── Log entry ────────────────────────────────────────────────────────────────

export interface PvacLogEntry {
  id: number
  timestamp: number   // ms since operation start
  message: string
  type: 'info' | 'step' | 'done' | 'error'
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface PvacOperationState {
  isRunning: boolean
  progress: PvacProgress | null
  error: string | null
  logs: PvacLogEntry[]
  elapsedMs: number
}

export interface UsePvacOperationReturn extends PvacOperationState {
  run<T>(operation: (onProgress: PvacProgressCallback) => Promise<PvacResult<T>>): Promise<PvacResult<T>>
  runWorker<T>(op: WorkerOp, payload: unknown): Promise<PvacResult<T>>
  reset(): void
  onProgress: PvacProgressCallback
}

// ─── Step → log message map ───────────────────────────────────────────────────

const STEP_MESSAGES: Record<string, string> = {
  initializing:        'Initializing crypto engine…',
  keygen:              'Deriving PVAC keypair from seed…',
  encrypting:          'FHE-encrypting value…',
  decrypting:          'Decrypting FHE cipher…',
  building_proof:      'Building zero-knowledge proof…',
  building_range_proof:'Building range proof for balance…',
  building_tx:         'Signing transaction…',
  registering_pubkey:  'Registering PVAC pubkey on node…',
  ecdh:                'Computing ECDH shared secret…',
  scanning:            'Scanning stealth outputs…',
  done:                'Operation complete.',
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePvacOperation(): UsePvacOperationReturn {
  const [state, setState] = useState<PvacOperationState>({
    isRunning: false,
    progress: null,
    error: null,
    logs: [],
    elapsedMs: 0,
  })

  const logCounterRef = useRef(0)
  const startTimeRef  = useRef(0)
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const onProgressRef = useRef<PvacProgressCallback>(() => {})

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    // Tick 4×/s instead of 10×/s — still feels live but dramatically reduces
    // React re-renders during long-running PVAC ops.
    timerRef.current = setInterval(() => {
      setState(prev => ({ ...prev, elapsedMs: Date.now() - startTimeRef.current }))
    }, 250)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setState(prev => ({ ...prev, elapsedMs: Date.now() - startTimeRef.current }))
  }, [])

  const addLog = useCallback((message: string, type: PvacLogEntry['type'] = 'step') => {
    const entry: PvacLogEntry = {
      id: ++logCounterRef.current,
      timestamp: Date.now() - startTimeRef.current,
      message,
      type,
    }
    setState(prev => ({ ...prev, logs: [...prev.logs, entry] }))
  }, [])

  const onProgress = useCallback<PvacProgressCallback>((progress) => {
    const message = STEP_MESSAGES[progress.step] ?? progress.label
    const type: PvacLogEntry['type'] = progress.step === 'done' ? 'done' : 'step'
    setState(prev => ({
      ...prev,
      progress,
      logs: [
        ...prev.logs,
        { id: ++logCounterRef.current, timestamp: Date.now() - startTimeRef.current, message, type },
      ],
    }))
  }, [])

  onProgressRef.current = onProgress

  // ── Main-thread run (legacy fallback) ─────────────────────────────────────

  const run = useCallback(async <T>(
    operation: (onProgress: PvacProgressCallback) => Promise<PvacResult<T>>,
  ): Promise<PvacResult<T>> => {
    logCounterRef.current = 0
    setState({ isRunning: true, progress: null, error: null, logs: [], elapsedMs: 0 })
    startTimer()
    addLog('Starting operation…', 'info')

    try {
      const result = await operation(onProgressRef.current)
      stopTimer()

      if (!result.success) {
        addLog(result.error ?? 'Operation failed', 'error')
        setState(prev => ({ ...prev, isRunning: false, error: result.error ?? 'Operation failed' }))
        return result
      }

      setState(prev => ({ ...prev, isRunning: false }))
      return result
    } catch (error) {
      stopTimer()
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(message, 'error')
      setState(prev => ({ ...prev, isRunning: false, error: message }))
      return { success: false, error: message }
    }
  }, [startTimer, stopTimer, addLog])

  // ── Worker run (non-blocking, preferred) ──────────────────────────────────

  const runWorker = useCallback(async <T>(
    op: WorkerOp,
    payload: unknown,
  ): Promise<PvacResult<T>> => {
    logCounterRef.current = 0
    setState({ isRunning: true, progress: null, error: null, logs: [], elapsedMs: 0 })
    startTimer()
    addLog('Starting operation…', 'info')

    if (!isWorkerAvailable()) {
      stopTimer()
      const msg = 'Web Workers not available in this context'
      addLog(msg, 'error')
      setState(prev => ({ ...prev, isRunning: false, error: msg }))
      return { success: false, error: msg }
    }

    try {
      const result = await runInWorker<T>(op, payload, onProgressRef.current)
      stopTimer()

      if (!result.success) {
        addLog(result.error ?? 'Operation failed', 'error')
        setState(prev => ({ ...prev, isRunning: false, error: result.error ?? 'Operation failed' }))
        return result
      }

      setState(prev => ({ ...prev, isRunning: false }))
      return result
    } catch (error) {
      stopTimer()
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(message, 'error')
      setState(prev => ({ ...prev, isRunning: false, error: message }))
      return { success: false, error: message }
    }
  }, [startTimer, stopTimer, addLog])

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    logCounterRef.current = 0
    setState({ isRunning: false, progress: null, error: null, logs: [], elapsedMs: 0 })
  }, [])

  return { ...state, run, runWorker, reset, onProgress }
}
