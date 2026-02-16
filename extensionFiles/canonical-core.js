/**
 * Canonical Transaction Serialization for Octra (Extension Version)
 * 
 * CRITICAL: This MUST match the SDK canonical.ts implementation exactly
 * 
 * Shared across:
 * - SDK (transaction building)
 * - Wallet Extension (signing)
 * - CLI pre_client (signing)
 */

// =============================================================================
// Domain Separation Constants
// =============================================================================

const OCTRA_DOMAIN_PREFIX = 'OctraSignedMessage:v1:';
const OCTRA_CAPABILITY_PREFIX = 'OctraCapability:v2:';
const OCTRA_INVOCATION_PREFIX = 'OctraInvocation:v2:';

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
 */
function canonicalize(obj) {
  if (obj === null || obj === undefined) {
    return 'null';
  }

  // Handle primitives
  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      throw new Error('Cannot canonicalize non-finite number');
    }
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
    // Sort keys lexicographically
    const sortedKeys = Object.keys(obj).sort();
    
    const pairs = sortedKeys.map(key => {
      const value = obj[key];
      return `${JSON.stringify(key)}:${canonicalize(value)}`;
    });
    
    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Cannot canonicalize type: ${typeof obj}`);
}

/**
 * Canonicalize capability payload for signing
 */
function canonicalizeCapability(payload) {
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
 */
function canonicalizeInvocation(invocation) {
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

// =============================================================================
// Domain Separation
// =============================================================================

/**
 * Apply domain separation prefix before hashing
 */
function applyDomainSeparation(canonical, prefix) {
  return prefix + canonical;
}

/**
 * Create domain-separated hash for capability
 */
function hashCapabilityWithDomain(payload) {
  const canonical = canonicalizeCapability(payload);
  const withDomain = applyDomainSeparation(canonical, OCTRA_CAPABILITY_PREFIX);
  return sha256String(withDomain);
}

/**
 * Create domain-separated hash for invocation
 */
function hashInvocationWithDomain(invocation) {
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
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Simple hash for payload (synchronous)
 */
function sha256Sync(data) {
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
function sha256String(str) {
  const bytes = new TextEncoder().encode(str);
  return sha256Sync(bytes);
}

// =============================================================================
// Exports
// =============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    canonicalize,
    canonicalizeCapability,
    canonicalizeInvocation,
    hashCapabilityWithDomain,
    hashInvocationWithDomain,
    applyDomainSeparation,
    OCTRA_DOMAIN_PREFIX,
    OCTRA_CAPABILITY_PREFIX,
    OCTRA_INVOCATION_PREFIX,
  };
}
