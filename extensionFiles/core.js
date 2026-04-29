/**
 * Octra Wallet — Core Cryptographic Utilities (Extension Version)
 *
 * CRITICAL: This MUST match the SDK canonical.ts implementation exactly.
 *
 * Shared across:
 * - SDK (transaction building)
 * - Wallet Extension (signing)
 * - CLI pre_client (signing)
 */

'use strict';

// =============================================================================
// Domain Separation Constants
// =============================================================================

const OCTRA_DOMAIN_PREFIX      = 'OctraSignedMessage:v1:';
const OCTRA_CAPABILITY_PREFIX  = 'OctraCapability:v2:';
const OCTRA_INVOCATION_PREFIX  = 'OctraInvocation:v2:';

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
function canonicalize(obj) {
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
    const pairs = Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Cannot canonicalize type: ${typeof obj}`);
}

/**
 * Canonicalize a capability payload for signing.
 * Methods array is sorted to ensure determinism.
 */
function canonicalizeCapability(payload) {
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
 * Canonicalize an invocation for signing.
 */
function canonicalizeInvocation(invocation) {
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

// =============================================================================
// Hashing — Web Crypto API (real SHA-256)
// =============================================================================

/**
 * Convert a byte array to a lowercase hex string.
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 hash of a Uint8Array.
 * Uses the Web Crypto API — available in both service workers (MV3) and page contexts.
 *
 * @param {Uint8Array} data
 * @returns {Promise<string>} lowercase hex digest
 */
async function sha256Bytes(data) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * SHA-256 hash of a UTF-8 string.
 *
 * @param {string} str
 * @returns {Promise<string>} lowercase hex digest
 */
async function sha256String(str) {
  return sha256Bytes(new TextEncoder().encode(str));
}

// =============================================================================
// Domain-Separated Hashing
// =============================================================================

/**
 * Prepend a domain-separation prefix before hashing.
 * Prevents cross-context signature reuse.
 */
function applyDomainSeparation(canonical, prefix) {
  return prefix + canonical;
}

/**
 * Domain-separated SHA-256 hash for a capability payload.
 *
 * @param {object} payload
 * @returns {Promise<string>} hex digest
 */
async function hashCapabilityWithDomain(payload) {
  const canonical   = canonicalizeCapability(payload);
  const withDomain  = applyDomainSeparation(canonical, OCTRA_CAPABILITY_PREFIX);
  return sha256String(withDomain);
}

/**
 * Domain-separated SHA-256 hash for an invocation.
 *
 * @param {object} invocation
 * @returns {Promise<string>} hex digest
 */
async function hashInvocationWithDomain(invocation) {
  const canonical   = canonicalizeInvocation(invocation);
  const withDomain  = applyDomainSeparation(canonical, OCTRA_INVOCATION_PREFIX);
  return sha256String(withDomain);
}

// =============================================================================
// Exports (CommonJS — used by background.js via importScripts / require)
// =============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    canonicalize,
    canonicalizeCapability,
    canonicalizeInvocation,
    hashCapabilityWithDomain,
    hashInvocationWithDomain,
    applyDomainSeparation,
    sha256Bytes,
    sha256String,
    bytesToHex,
    OCTRA_DOMAIN_PREFIX,
    OCTRA_CAPABILITY_PREFIX,
    OCTRA_INVOCATION_PREFIX,
  };
}
