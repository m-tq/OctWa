// Read-only ONS client. All methods hit the Octra RPC directly; nothing here
// requires a wallet, a capability, or the OctWa SDK.
//
// Three public entrypoints:
//
//   resolveOnsName(input)        name/address → address ('' when unresolved)
//   lookupOnsName(input)         name/address → full record (null when absent)
//   reverseOnsLookup(addr)       address      → primary name (''  when none)
//
// Plus a lower-level `createOnsClient(config)` for hosts that need a scoped
// instance (e.g. an explorer that resolves across both networks at once).

import { TtlCache } from './cache'
import { getOnsConfig, makeOnsConfig, type OnsConfig } from './config'

// ─── Public types ────────────────────────────────────────────────────────

export type ResolveState =
  | 'pending'      // not yet resolved (used by the React hook)
  | 'passthrough'  // input is already a valid oct address
  | 'resolved'     // input is an ONS label that mapped to an address
  | 'not-found'    // input is a label but the chain has no active record
  | 'error'        // RPC failed

export interface OnsRecord {
  label:        string
  destination:  string
  owner:        string
  viewPk:       string
  expiry:       number
  registeredAt: number
  isActive:     boolean
}

export interface OnsClient {
  resolve:       (input: string, opts?: { fresh?: boolean }) => Promise<string>
  lookup:        (input: string, opts?: { fresh?: boolean }) => Promise<OnsRecord | null>
  reverse:       (addr: string,   opts?: { fresh?: boolean }) => Promise<string>
  invalidate:    (key: string) => void
  clearCache:    () => void
  readonly config: OnsConfig
}

// ─── Input classification ────────────────────────────────────────────────

const OCT_ADDRESS_RE = /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/
const LABEL_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

export function isOctAddress(input: string): boolean {
  return OCT_ADDRESS_RE.test(input)
}

export function normalizeLabel(input: string): string {
  return input.trim().toLowerCase().replace(/\.oct$/i, '')
}

export function isValidLabel(label: string): boolean {
  if (!label) return false
  const normalized = normalizeLabel(label)
  if (normalized.length < 3 || normalized.length > 63) return false
  return LABEL_RE.test(normalized)
}

// ─── Internals ───────────────────────────────────────────────────────────

let nextId = 1

async function rpcCall<T = unknown>(
  config: OnsConfig,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)

  try {
    const res = await fetch(`${config.rpcUrl.replace(/\/+$/, '')}/rpc`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal:  controller.signal,
    })
    const json = await res.json()
    if (json.error) {
      throw new Error(json.error.message || json.error.reason || 'rpc error')
    }
    return json.result as T
  } finally {
    clearTimeout(timer)
  }
}

interface ContractCallResponse<T> {
  result:  T
  storage?: Record<string, unknown>
}

async function contractView<T = unknown>(
  config: OnsConfig,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await rpcCall<ContractCallResponse<T> | T>(config, 'contract_call', [
    config.contract,
    method,
    params,
  ])
  if (res && typeof res === 'object' && 'result' in (res as Record<string, unknown>)) {
    return (res as ContractCallResponse<T>).result
  }
  return res as T
}

async function viewString(config: OnsConfig, method: string, params: unknown[] = []): Promise<string> {
  const v = await contractView<string>(config, method, params)
  return typeof v === 'string' ? v : String(v ?? '')
}

async function viewInt(config: OnsConfig, method: string, params: unknown[] = []): Promise<number> {
  const v = await contractView<string | number>(config, method, params)
  if (typeof v === 'number') return v
  const parsed = Number.parseInt(String(v ?? '0'), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function viewBool(config: OnsConfig, method: string, params: unknown[] = []): Promise<boolean> {
  const v = await contractView<string | boolean | number>(config, method, params)
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return v === 'true' || v === '1'
}

// ─── Client factory ──────────────────────────────────────────────────────

export function createOnsClient(configPatch: Partial<OnsConfig> = {}): OnsClient {
  const config = makeOnsConfig(configPatch)

  const addressCache = new TtlCache<string>(128, config.cacheTtlMs)
  const recordCache  = new TtlCache<OnsRecord | null>(128, config.cacheTtlMs)
  const reverseCache = new TtlCache<string>(128, config.cacheTtlMs)

  async function resolve(input: string, opts: { fresh?: boolean } = {}): Promise<string> {
    const trimmed = input.trim()
    if (!trimmed) return ''
    if (isOctAddress(trimmed)) return trimmed

    const label = normalizeLabel(trimmed)
    if (!isValidLabel(label)) return ''

    const key = `resolve:${label}`
    if (!opts.fresh) {
      const hit = addressCache.get(key)
      if (hit !== undefined) return hit
    }

    const addr = await viewString(config, 'resolve', [label])
    const normalized = addr === '0' ? '' : addr
    addressCache.set(key, normalized, config.cacheTtlMs)
    return normalized
  }

  async function lookup(input: string, opts: { fresh?: boolean } = {}): Promise<OnsRecord | null> {
    const trimmed = input.trim()
    if (!trimmed) return null

    // Accept raw addresses too — we reverse-resolve them to the primary name.
    if (isOctAddress(trimmed)) {
      const primary = await reverse(trimmed, opts)
      if (!primary) return null
      return lookup(primary, opts)
    }

    const label = normalizeLabel(trimmed)
    if (!isValidLabel(label)) return null

    const key = `record:${label}`
    if (!opts.fresh) {
      const hit = recordCache.get(key)
      if (hit !== undefined) return hit
    }

    const [owner, destination, viewPk, expiry, registeredAt, isActive] = await Promise.all([
      viewString(config, 'owner_of',       [label]),
      viewString(config, 'destination_of', [label]),
      viewString(config, 'view_pk_of',     [label]),
      viewInt(config,    'expiry_of',      [label]),
      viewInt(config,    'registered_at',  [label]),
      viewBool(config,   'is_active',      [label]),
    ])

    if (!owner || owner === '0') {
      recordCache.set(key, null, config.cacheTtlMs)
      return null
    }

    const record: OnsRecord = {
      label,
      destination: destination === '0' ? '' : destination,
      owner,
      viewPk,
      expiry,
      registeredAt,
      isActive,
    }
    recordCache.set(key, record, config.cacheTtlMs)
    return record
  }

  async function reverse(addr: string, opts: { fresh?: boolean } = {}): Promise<string> {
    const trimmed = addr.trim()
    if (!isOctAddress(trimmed)) return ''

    const key = `reverse:${trimmed}`
    if (!opts.fresh) {
      const hit = reverseCache.get(key)
      if (hit !== undefined) return hit
    }

    const name = await viewString(config, 'primary_of', [trimmed])
    reverseCache.set(key, name, config.cacheTtlMs)
    return name
  }

  function invalidate(key: string): void {
    addressCache.invalidate(key)
    recordCache.invalidate(key)
    reverseCache.invalidate(key)
  }

  function clearCache(): void {
    addressCache.clear()
    recordCache.clear()
    reverseCache.clear()
  }

  return { resolve, lookup, reverse, invalidate, clearCache, config }
}

// ─── Default (singleton) client backed by the global config ─────────────

let defaultClient: OnsClient | null = null
let defaultClientSignature: string | null = null

function getDefaultClient(): OnsClient {
  const config = getOnsConfig()
  const signature = `${config.network}|${config.contract}|${config.rpcUrl}|${config.cacheTtlMs}|${config.requestTimeoutMs}`
  if (!defaultClient || defaultClientSignature !== signature) {
    defaultClient = createOnsClient(config)
    defaultClientSignature = signature
  }
  return defaultClient
}

// ─── Public singletons ───────────────────────────────────────────────────

export function resolveOnsName(input: string, opts?: { fresh?: boolean }): Promise<string> {
  return getDefaultClient().resolve(input, opts)
}

export function lookupOnsName(input: string, opts?: { fresh?: boolean }): Promise<OnsRecord | null> {
  return getDefaultClient().lookup(input, opts)
}

export function reverseOnsLookup(addr: string, opts?: { fresh?: boolean }): Promise<string> {
  return getDefaultClient().reverse(addr, opts)
}

export function clearOnsCache(): void {
  getDefaultClient().clearCache()
}
