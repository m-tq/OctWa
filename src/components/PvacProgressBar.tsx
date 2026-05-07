/**
 * Progress indicator for PVAC crypto operations.
 *
 * Shows a labeled progress bar with the current step description.
 * Designed to be embedded inside dialogs during long-running operations.
 */

import { Loader2 } from 'lucide-react'
import type { PvacProgress } from '@/lib/pvac/types'

interface PvacProgressBarProps {
  progress: PvacProgress | null
  isRunning: boolean
  /** Optional override label shown when not running. */
  idleLabel?: string
}

export function PvacProgressBar({ progress, isRunning, idleLabel }: PvacProgressBarProps) {
  if (!isRunning && !progress) return null

  const percent = progress?.percent ?? 0
  const label = progress?.label ?? idleLabel ?? 'Processing…'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
        <span className="truncate">{label}</span>
        <span className="ml-auto shrink-0 tabular-nums">{percent}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
