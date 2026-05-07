/**
 * rangeProofServer.ts → pvacLocalServer.ts
 *
 * Client for the local pvac-local-server — a native binary that handles
 * the full decrypt and stealth send operations (including range proof).
 *
 * Endpoints:
 *   POST /decrypt_to_public  — build signed decrypt tx
 *   POST /stealth_send       — build signed stealth send tx
 *   GET  /health             — liveness check
 *
 * No auth token — binds to 127.0.0.1 only.
 * Default URL: http://127.0.0.1:9090
 */

const STORAGE_KEY       = 'pvacRangeServerUrl'
const DEFAULT_URL       = 'http://127.0.0.1:9090'
const HEALTH_TIMEOUT_MS = 3_000
const OP_TIMEOUT_MS     = 1_800_000  // 30 min — range proof can take 4-20 min

// ─── URL management ───────────────────────────────────────────────────────────

export function getRangeServerUrl(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL } catch { return DEFAULT_URL }
}

export function setRangeServerUrl(url: string): void {
  try { localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, '')) } catch { /* ignore */ }
}

export function resetRangeServerUrl(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function isRangeServerAvailable(url?: string): Promise<boolean> {
  const base = (url ?? getRangeServerUrl()).replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (!res.ok) return false
    const data = await res.json()
    return data?.status === 'ok'
  } catch { return false }
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class RangeServerError extends Error {
  constructor(message: string, public readonly isUnavailable = false) {
    super(message)
    this.name = 'RangeServerError'
  }
}

// ─── Shared POST helper ───────────────────────────────────────────────────────

async function postToServer(endpoint: string, body: Record<string, unknown>, serverUrl?: string): Promise<unknown> {
  const base = (serverUrl ?? getRangeServerUrl()).replace(/\/$/, '')
  let response: Response

  // Use manual AbortController instead of AbortSignal.timeout() —
  // AbortSignal.timeout may not work reliably in Chrome extension contexts
  // for very long-running requests (5+ minutes).
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), OP_TIMEOUT_MS)

  try {
    response = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    throw new RangeServerError(
      isAbort
        ? `pvac-local-server timed out after ${OP_TIMEOUT_MS / 60000} min`
        : `pvac-local-server not reachable at ${base}. Is it running?`,
      !isAbort,
    )
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok || !(data as Record<string, unknown>).success) {
    throw new RangeServerError(
      (data as Record<string, unknown>).error as string ?? `Server returned HTTP ${response.status}`,
    )
  }
  return data
}

// ─── decrypt_to_public ────────────────────────────────────────────────────────

export interface DecryptRequest {
  privateKey:      string
  publicKey:       string
  address:         string
  amountRaw:       bigint
  currentCipher:   string
  /** Plaintext current balance in microOCT — avoids server re-decrypting the cipher. */
  currentBalance:  bigint
  nonce:           number
  ou:              string
  timestamp:       number
  /** RPC node URL — server fetches fresh cipher directly from node before building tx. */
  rpcUrl:          string
}

export async function serverDecryptToPublic(req: DecryptRequest, serverUrl?: string): Promise<{ tx: unknown }> {
  const body: Record<string, unknown> = {
    private_key:      req.privateKey,
    public_key:       req.publicKey,
    address:          req.address,
    amount:           req.amountRaw.toString(),
    current_cipher:   req.currentCipher,
    nonce:            req.nonce,
    ou:               req.ou,
    timestamp:        req.timestamp,
    rpc_url:          req.rpcUrl,
  }
  // Only send current_balance hint when it's a valid positive value.
  // -1n signals "no hint" — server will decrypt the fresh cipher itself.
  if (req.currentBalance >= 0n) {
    body.current_balance = req.currentBalance.toString()
  }
  const data = await postToServer('/decrypt_to_public', body, serverUrl)
  return { tx: (data as Record<string, unknown>).tx }
}

// ─── stealth_send ─────────────────────────────────────────────────────────────

export interface StealthSendRequest {
  privateKey:           string
  publicKey:            string
  fromAddress:          string
  toAddress:            string
  amountRaw:            bigint
  currentCipher:        string
  recipientViewPubkey:  string
  nonce:                number
  ou:                   string
  timestamp:            number
  /** RPC node URL -- server fetches fresh cipher directly from node before building tx. */
  rpcUrl?:              string
}

export async function serverStealthSend(req: StealthSendRequest, serverUrl?: string): Promise<{ tx: unknown }> {
  const data = await postToServer('/stealth_send', {
    private_key:           req.privateKey,
    public_key:            req.publicKey,
    from_address:          req.fromAddress,
    to_address:            req.toAddress,
    amount:                req.amountRaw.toString(),
    current_cipher:        req.currentCipher,
    recipient_view_pubkey: req.recipientViewPubkey,
    nonce:                 req.nonce,
    ou:                    req.ou,
    timestamp:             req.timestamp,
    rpc_url:               req.rpcUrl ?? '',
  }, serverUrl)
  return { tx: (data as Record<string, unknown>).tx }
}

// ─── Legacy range proof export (kept for compatibility) ───────────────────────
export interface RangeProofRequest {
  privateKey: string; cipher: string; amountCipher: string; value: bigint
}
export async function requestRangeProof(_req: RangeProofRequest): Promise<{ rangeProof: string }> {
  throw new RangeServerError('Use serverDecryptToPublic or serverStealthSend instead')
}
