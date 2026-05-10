// Optional React bindings.
// Host apps that do not use React can ignore this file entirely.

import { useEffect, useRef, useState } from 'react'

import {
  isOctAddress,
  lookupOnsName,
  normalizeLabel,
  isValidLabel,
  type OnsRecord,
  type ResolveState,
} from './client'

export interface UseOnsResolverResult {
  state:        ResolveState
  /** The resolved target address. Equals the input when state is `passthrough`. */
  address:      string
  /** Present when the input resolved to an ONS label. */
  record:       OnsRecord | null
  /** Pulled from `record` for convenience. */
  viewPk:       string
  /** Error message when state is `error`. */
  error:        string | null
  /** True once the hook has finished its first round of work. */
  ready:        boolean
}

export interface UseOnsResolverOptions {
  /** Debounce window before a resolve is issued, in milliseconds. */
  debounceMs?: number
  /** Skip lookup entirely when false (useful for feature flags). */
  enabled?:    boolean
}

const DEFAULT_DEBOUNCE_MS = 250

/**
 * React hook that turns a free-text recipient field into a typed resolver
 * result. Handles:
 *   - passthrough when the user pastes a raw oct address
 *   - debounced lookups when the user types a label
 *   - stale-response protection when the input changes mid-flight
 */
export function useOnsResolver(
  input: string,
  { debounceMs = DEFAULT_DEBOUNCE_MS, enabled = true }: UseOnsResolverOptions = {},
): UseOnsResolverResult {
  const [state,   setState]   = useState<ResolveState>('pending')
  const [address, setAddress] = useState<string>('')
  const [record,  setRecord]  = useState<OnsRecord | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [ready,   setReady]   = useState<boolean>(false)

  const latestInputRef = useRef<string>('')

  useEffect(() => {
    if (!enabled) {
      setState('pending')
      setAddress('')
      setRecord(null)
      setError(null)
      setReady(true)
      return
    }

    const trimmed = input.trim()
    latestInputRef.current = trimmed

    // Empty input resets back to a clean pending state with no network work.
    if (!trimmed) {
      setState('pending')
      setAddress('')
      setRecord(null)
      setError(null)
      setReady(true)
      return
    }

    // Passthrough — the user typed a full oct address, nothing to resolve.
    if (isOctAddress(trimmed)) {
      setState('passthrough')
      setAddress(trimmed)
      setRecord(null)
      setError(null)
      setReady(true)
      return
    }

    const label = normalizeLabel(trimmed)
    if (!isValidLabel(label)) {
      setState('not-found')
      setAddress('')
      setRecord(null)
      setError(null)
      setReady(true)
      return
    }

    // Debounced real lookup.
    setState('pending')
    setError(null)
    setReady(false)

    const timer = window.setTimeout(async () => {
      try {
        const result = await lookupOnsName(label)

        // Another input came in while we were resolving — discard.
        if (latestInputRef.current !== trimmed) return

        if (!result || !result.isActive || !result.destination) {
          setState('not-found')
          setAddress('')
          setRecord(result)
        } else {
          setState('resolved')
          setAddress(result.destination)
          setRecord(result)
        }
        setError(null)
      } catch (err) {
        if (latestInputRef.current !== trimmed) return
        setState('error')
        setError((err as Error).message)
      } finally {
        if (latestInputRef.current === trimmed) setReady(true)
      }
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [input, debounceMs, enabled])

  return {
    state,
    address,
    record,
    viewPk: record?.viewPk ?? '',
    error,
    ready,
  }
}
