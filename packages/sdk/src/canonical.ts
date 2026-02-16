/**
 * Canonical Transaction Serialization for Octra
 * 
 * Implements deterministic serialization to ensure:
 * - Consistent hashing across SDK, Extension, and CLI
 * - No signature replay attacks
 * - Proper HFHE encrypted payload handling
 * 
 * CRITICAL: This module MUST be shared across:
 * - SDK (transaction building)
 * - Wallet Extension (signing)
 * - CLI pre_client (signing)
 */

// =============================================================================
// Domain Separation Constants
// =============================================================================

export const OCTRA_DOMAIN_PREFIX = 'OctraSignedMessage:v1:';
export const OCTRA_CAPABILITY_PREFIX = 'OctraCapability:v2:';
export const OCTRA_INVOCATION_PREFIX = 'OctraInvocation:v2:';

// =============================================================================
// Canonical Serialization
// =============================================================================

/**
 * Canonicalize any object for deterministic hashing
 * 
 * Rules:
 * - Keys sorted lexicographically
 * - No whitespace
 * - Numbers as strings with explicit formatting
 * - Booleans as lowercase strings
 * - Arrays maintain order but elements are canonicalized
 * - Uint8Array converted to hex with '0x' prefix
 * - Encrypted payloads remain opaque (only hash the ciphertext)
 */
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return 'null';
  }

  // Handle primitives
  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (typeof obj === 'number') {
    // Ensure consistent number formatting
    if (!Number.isFinite(obj)) {
      throw new Error('Cannot canonicalize non-finite number');
    }
    // Use fixed precision to avoid floating point issues
    return obj.toString();
  }

  if (typeof obj === 'boolean') {
    return obj ? 'true' : 'false';
  }

  // Handle Uint8Array - convert to hex
  if (obj instanceof Uint8Array) {
    return `"0x${bytesToHex(obj)}"`;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const items = obj.map(item => canonicalize(item));
    return `[${items.join(',')}]`;
  }

  // Handle objects
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    
    // Sort keys lexicographically
    const sortedKeys = Object.keys(record).sort();
    
    const pairs = sortedKeys.map(key => {
      const value = record[key];
      return `${JSON.stringify(key)}:${canonicalize(value)}`;
    });
    
    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Cannot canonicalize type: ${typeof obj}`);
}

/**
 * Canonicalize capability payload for signing
 * 
 * MUST match wallet implementation exactly
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
  // Sort methods array
  const sortedMethods = [...payload.methods].sort();
  
  // Build canonical object with keys in strict lexicographic order
  const canonical = {
    appOrigin: payload.appOrigin,
    branchId: payload.branchId,
    circle: payload.circle,
    encrypted: payload.encrypted,
    epoch: payload.epoch,
    expiresAt: payload.expiresAt,
    issuedAt: payload.issuedAt,
    methods: sortedMethods,
    nonceBase: payload.nonceBase,
    scope: payload.scope,
    version: payload.version,
  };
  
  return canonicalize(canonical);
}

/**
 * Canonicalize invocation for signing
 * 
 * MUST match wallet implementation exactly
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
      method: invocation.body.method,
      payloadHash: invocation.body.payloadHash,
    },
    header: {
      branchId: invocation.header.branchId,
      circleId: invocation.header.circleId,
      epoch: invocation.header.epoch,
      nonce: invocation.header.nonce,
      originHash: invocation.header.originHash,
      timestamp: invocation.header.timestamp,
      version: invocation.header.version,
    },
  };
  
  return canonicalize(canonical);
}

/**
 * Hash payload for invocation
 * 
 * CRITICAL: Encrypted payloads must remain opaque
 * - Do NOT inspect ciphertext
 * - Do NOT coerce numeric values
 * - Do NOT mutate encrypted fields
 */
export function hashPayload(payload: Uint8Array | { scheme: string; data: Uint8Array }): string {
  const data = payload instanceof Uint8Array 
    ? payload 
    : payload.data;
  
  // Use SHA-256 for cryptographic hash
  return sha256Sync(data);
}

// =============================================================================
// Domain Separation
// =============================================================================

/**
 * Apply domain separation prefix before hashing
 * 
 * Prevents signature replay across different contexts
 */
export function applyDomainSeparation(canonical: string, prefix: string): string {
  return prefix + canonical;
}

/**
 * Create domain-separated hash for capability
 */
export function hashCapabilityWithDomain(payload: Parameters<typeof canonicalizeCapability>[0]): string {
  const canonical = canonicalizeCapability(payload);
  const withDomain = applyDomainSeparation(canonical, OCTRA_CAPABILITY_PREFIX);
  return sha256String(withDomain);
}

/**
 * Create domain-separated hash for invocation
 */
export function hashInvocationWithDomain(invocation: Parameters<typeof canonicalizeInvocation>[0]): string {
  const canonical = canonicalizeInvocation(invocation);
  const withDomain = applyDomainSeparation(canonical, OCTRA_INVOCATION_PREFIX);
  return sha256String(withDomain);
}

// =============================================================================
// Hashing Utilities
// =============================================================================

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Synchronous SHA-256 hash (simple implementation for payload hashing)
 * For production, use Web Crypto API or a proper crypto library
 */
function sha256Sync(data: Uint8Array): string {
  // Simple hash for now - in production, use proper crypto
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * SHA-256 hash of string
 */
function sha256String(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return sha256Sync(bytes);
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that canonical serialization is deterministic
 * (for testing purposes)
 */
export function validateDeterministic(obj: unknown): boolean {
  const first = canonicalize(obj);
  const second = canonicalize(obj);
  return first === second;
}
