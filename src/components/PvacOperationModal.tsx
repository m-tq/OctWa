/**
 * PvacOperationModal
 *
 * Full-screen blocking overlay shown during heavy PVAC crypto operations.
 * Covers the entire viewport including header, sidebars, and all panels.
 *
 * Displays:
 *   - Operation title + animated icon
 *   - Elapsed time counter
 *   - Progress bar (0-100%)
 *   - Realtime inline log with timestamps
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, CheckCircle2, XCircle, Lock, Unlock, Shield, Gift } from 'lucide-react'
import type { PvacLogEntry, PvacOperationState } from '@/hooks/usePvacOperation'

export type PvacOpType = 'encrypt' | 'decrypt' | 'stealth_send' | 'claim'

interface PvacOperationModalProps extends PvacOperationState {
  opType: PvacOpType
  onDismiss: () => void
}

const OP_CONFIG: Record<PvacOpType, { title: string; subtitle: string; icon: React.ReactNode }> = {
  encrypt: {
    title: 'Encrypting Balance',
    subtitle: 'Moving OCT to private encrypted balance',
    icon: <Lock className="h-6 w-6 text-[#00E5C0]" />,
  },
  decrypt: {
    title: 'Decrypting Balance',
    subtitle: 'Moving OCT back to public balance',
    icon: <Unlock className="h-6 w-6 text-[#00E5C0]" />,
  },
  stealth_send: {
    title: 'Stealth Transfer',
    subtitle: 'Sending OCT privately via FHE',
    icon: <Shield className="h-6 w-6 text-[#00E5C0]" />,
  },
  claim: {
    title: 'Claiming Transfer',
    subtitle: 'Adding received OCT to encrypted balance',
    icon: <Gift className="h-6 w-6 text-[#00E5C0]" />,
  },
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatLogTime(ms: number): string {
  if (ms < 1000) return `+${ms}ms`
  return `+${(ms / 1000).toFixed(1)}s`
}

function LogLine({ entry }: { entry: PvacLogEntry }) {
  const colors: Record<PvacLogEntry['type'], string> = {
    info:  'text-muted-foreground',
    step:  'text-foreground',
    done:  'text-[#00E5C0]',
    error: 'text-destructive',
  }
  const prefixes: Record<PvacLogEntry['type'], string> = {
    info:  '·',
    step:  '>',
    done:  '+',
    error: '!',
  }

  return (
    <div className="flex items-start gap-2 font-mono text-[11px] leading-relaxed">
      <span className="text-muted-foreground/50 shrink-0 w-12 text-right tabular-nums">
        {formatLogTime(entry.timestamp)}
      </span>
      <span className={`shrink-0 ${colors[entry.type]}`}>{prefixes[entry.type]}</span>
      <span className={colors[entry.type]}>{entry.message}</span>
    </div>
  )
}

export function PvacOperationModal({
  opType,
  isRunning,
  progress,
  error,
  logs,
  elapsedMs,
  onDismiss,
}: PvacOperationModalProps) {
  const logEndRef = useRef<HTMLDivElement>(null)
  const config = OP_CONFIG[opType]
  const isDone = !isRunning && !error && logs.some(l => l.type === 'done')
  const isError = !isRunning && !!error

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const percent = progress?.percent ?? 0

  // Render via portal so the overlay escapes any parent stacking context
  // (Dialog, positioned containers, etc.) and truly covers the full viewport.
  return createPortal(
    // z-[9999] — above everything including shadcn Dialog (z-50) and our panels (z-500)
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Solid backdrop */}
      <div className="absolute inset-0 bg-background/95 backdrop-blur-sm" />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-sm mx-4 border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
          <div className="shrink-0">
            {isRunning && <div className="animate-pulse">{config.icon}</div>}
            {isDone   && <CheckCircle2 className="h-6 w-6 text-[#00E5C0]" />}
            {isError  && <XCircle className="h-6 w-6 text-destructive" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
              {config.title}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {isError ? error : config.subtitle}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {formatElapsed(elapsedMs)}
            </div>
            {isRunning && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto mt-0.5" />
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 w-full bg-muted">
          <div
            className="h-full bg-[#00E5C0] transition-all duration-300 ease-out"
            style={{ width: `${isDone ? 100 : percent}%` }}
          />
        </div>

        {/* Log area */}
        <div className="px-3 py-2 h-48 overflow-y-auto bg-background/50 space-y-0.5">
          {logs.length === 0 && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/50">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Initializing...</span>
            </div>
          )}
          {logs.map(entry => (
            <LogLine key={entry.id} entry={entry} />
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-muted/30 flex items-center justify-between">
          {isRunning ? (
            <p className="text-[10px] text-muted-foreground">
              Do not close this window...
            </p>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                {isDone
                  ? `Completed in ${formatElapsed(elapsedMs)}`
                  : `Failed after ${formatElapsed(elapsedMs)}`}
              </p>
              <button
                onClick={onDismiss}
                className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
