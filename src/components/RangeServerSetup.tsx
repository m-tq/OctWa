/**
 * RangeServerSetup — Banner shown when pvac_server is not running.
 *
 * Displayed inside Decrypt and Stealth Send dialogs when the local server
 * is unavailable.
 */

import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getRangeServerUrl,
  setRangeServerUrl,
  isRangeServerAvailable,
} from '@/services/rangeProofServer'

interface RangeServerSetupProps {
  onAvailable: () => void
  compact?: boolean
}

export function RangeServerSetup({ onAvailable, compact = false }: RangeServerSetupProps) {
  const [url, setUrl] = useState(getRangeServerUrl)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<'unknown' | 'ok' | 'error'>('unknown')

  useEffect(() => {
    checkServer()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function checkServer() {
    setChecking(true)
    setStatus('unknown')
    const ok = await isRangeServerAvailable(url)
    setStatus(ok ? 'ok' : 'error')
    setChecking(false)
    if (ok) onAvailable()
  }

  function handleSaveUrl() {
    setRangeServerUrl(url)
    checkServer()
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-600">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>pvac_server required —</span>
        <button className="underline hover:no-underline" onClick={checkServer}>
          retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
      {/* Header */}
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
        <p className="font-medium text-yellow-600">pvac_server required</p>
      </div>

      {/* URL input + Save */}
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://127.0.0.1:9090"
          className="h-9 font-mono text-xs"
        />
        <Button
          variant="outline"
          className="h-9 shrink-0 text-xs"
          onClick={handleSaveUrl}
          disabled={checking}
        >
          Save
        </Button>
      </div>

      {/* Status + retry */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs">
          {status === 'ok' && (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-600">Server connected</span>
            </>
          )}
          {status === 'error' && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-yellow-600">Not reachable at {url}</span>
            </>
          )}
          {status === 'unknown' && checking && (
            <span className="text-muted-foreground">Checking…</span>
          )}
        </div>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs"
          onClick={checkServer}
          disabled={checking}
        >
          <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking…' : 'Retry'}
        </Button>
      </div>

      {/* Docs link */}
      <a
        href="https://github.com/m-tq/OctWa/tree/master/pvac_server/range_server"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        pvac_server — build &amp; run guide
      </a>
    </div>
  )
}
