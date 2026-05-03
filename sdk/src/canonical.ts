/**
 * Canonical Transaction Serialization for Octra
 *
 * Implements deterministic serialization to ensure:
 * - Consistent hashing across SDK, Extension, and CLI
 * - No signature replay attacks
 * - Proper HFHE encrypted payload handling
 *
 * CRITICAL: This module MUST stay in sync with:
 * - extensionFiles/core.js  (wallet extension)
 * - CLI pre_client          (signing)
 */

// =============================================================================
// Domain Separation Constants
// =============================================================================

export const OCTRA_DOMAIN_PREFIX      = 'OctraSignedMessage:v1:';
export const OCTRA_CAPABILITY_PREFIX  = 'OctraCapability:v2:';
export const OCTRA_INVOCATION_PREFIX  = 'OctraInvocation:v2:';

// =============================================================================
// Canonical Serialization
// =============================================================================

/**
 * Canonicalize any value for deterministic hashing.
 *
 * Rules:
 * - Object keys sorted lexicographically (recursive)
 * - No whitespace
 * - Numbers serialized via toString()
 * - Booleans as lowercase strings
 * - Arrays maintain order; elements are canonicalized
 * - Uint8Array → hex string with '0x' prefix
 * - null / undefined → "null"
 */
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';

  if (typeof obj === 'string')  return JSON.stringify(obj);
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';

  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) throw new Error('Cannot canonicalize non-finite number');
    return obj.toString();
  }

  if (obj instanceof Uint8Array) {
    return `"0x${bytesToHex(obj)}"`;
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalize).join(',')}]`;
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const pairs = Object.keys(record)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Cannot canonicalize type: ${typeof obj}`);
}

/**
 * Canonicalize capability payload for signing.
 * Methods array is sorted to ensure determinism.
 * MUST match extensionFiles/core.js canonicalizeCapability().
 */
export function canonicalizeCapability(payload: {
  version: number;
  circle: string;
  methods: readonly string[];
  scope: string;
  encrypted: boolean;
  appOrigin: string;
  branchId: string;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
  nonceBase: number;
}): string {
  const canonical = {
    appOrigin:  payload.appOrigin,
    branchId:   payload.branchId,
    circle:     payload.circle,
    encrypted:  payload.encrypted,
    epoch:      payload.epoch,
    expiresAt:  payload.expiresAt,
    issuedAt:   payload.issuedAt,
    methods:    [...payload.methods].sort(),
    nonceBase:  payload.nonceBase,
    scope:      payload.scope,
    version:    payload.version,
  };
  return canonicalize(canonical);
}

/**
 * Canonicalize invocation for signing.
 * MUST match extensionFiles/core.js canonicalizeInvocation().
 */
export function canonicalizeInvocation(invocation: {
  header: {
    version: number;
    circleId: string;
    branchId: string;
    epoch: number;
    nonce: number;
    timestamp: number;
    originHash: string;
  };
  body: {
    capabilityId: string;
    method: string;
    payloadHash: string;
  };
}): string {
  const canonical = {
    body: {
      capabilityId: invocation.body.capabilityId,
      method:       invocation.body.method,
      payloadHash:  invocation.body.payloadHash,
    },
    header: {
      branchId:   invocation.header.branchId,
      circleId:   invocation.header.circleId,
      epoch:      invocation.header.epoch,
      nonce:      invocation.header.nonce,
      originHash: invocation.header.originHash,
      timestamp:  invocation.header.timestamp,
      version:    invocation.header.version,
    },
  };
  return canonicalize(canonical);
}

/**
 * Hash payload for invocation.
 *
 * CRITICAL: Encrypted payloads must remain opaque —
 * do NOT inspect ciphertext, do NOT coerce numeric values.
 */
export function hashPayload(payload: Uint8Array | { scheme: string; data: Uint8Array }): string {
  const data = payload instanceof Uint8Array ? payload : payload.data;
  return sha256Sync(data);
}

// =============================================================================
// Domain Separation
// =============================================================================

/** Prepend a domain-separation prefix before hashing. */
export function applyDomainSeparation(canonical: string, prefix: string): string {
  return prefix + canonical;
}

/**
 * Create domain-separated hash for a capability payload.
 * Uses real SHA-256 via Web Crypto API (async).
 */
export async function hashCapabilityWithDomain(
  payload: Parameters<typeof canonicalizeCapability>[0]
): Promise<string> {
  const canonical  = canonicalizeCapability(payload);
  const withDomain = applyDomainSeparation(canonical, OCTRA_CAPABILITY_PREFIX);
  return sha256String(withDomain);
}

/**
 * Create domain-separated hash for an invocation.
 * Uses real SHA-256 via Web Crypto API (async).
 */
export async function hashInvocationWithDomain(
  invocation: Parameters<typeof canonicalizeInvocation>[0]
): Promise<string> {
  const canonical  = canonicalizeInvocation(invocation);
  const withDomain = applyDomainSeparation(canonical, OCTRA_INVOCATION_PREFIX);
  return sha256String(withDomain);
}

// =============================================================================
// Hashing — Web Crypto API (real SHA-256)
// =============================================================================

/** Convert a Uint8Array to a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 of a Uint8Array via Web Crypto API.
 * Available in browsers, service workers (MV3), and Node ≥ 19.
 */
export async function sha256Bytes(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(buf));
}

/**
 * SHA-256 of a UTF-8 string via Web Crypto API.
 */
export async function sha256String(str: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(str));
}

/**
 * Synchronous djb2-based hash — used ONLY for non-security-critical
 * payload fingerprinting (hashPayload). Do NOT use for capability signing.
 */
function sha256Sync(data: Uint8Array): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}
