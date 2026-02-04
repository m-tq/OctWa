/**
 * Octra Capability Crypto Layer
 * 
 * Implements cryptographic operations for capability signing and verification.
 * Based on: packages/octra_capability_sdk_deterministic_test_vectors.md
 * 
 * - Curve: ed25519
 * - Hash: SHA-256
 * - Encoding: UTF-8
 * - Canonicalization: strict JSON with sorted keys & arrays
 */

import type { Capability, CapabilityPayload } from './types';

// ============================================================================
// Canonicalization
// ============================================================================

/**
 * Canonicalize capability payload for deterministic signing
 * 
 * Rules:
 * - Keys MUST be sorted lexicographically
 * - No extra whitespace
 * - No undefined/null fields
 * - methods[] MUST be sorted lexicographically
 * - Boolean values are lowercase
 */
export function canonicalizeCapabilityPayload(payload: CapabilityPayload): string {
  // Sort methods array
  const sortedMethods = [...payload.methods].sort();
  
  // Build canonical object with keys in lexicographic order
  const canonical: Record<string, unknown> = {};
  
  // Add fields in strict lexicographic order
  canonical.appOrigin = payload.appOrigin;
  canonical.circle = payload.circle;
  canonical.encrypted = payload.encrypted;
  canonical.expiresAt = payload.expiresAt;
  canonical.issuedAt = payload.issuedAt;
  canonical.methods = sortedMethods;
  canonical.nonce = payload.nonce;
  canonical.scope = payload.scope;
  canonical.version = payload.version;
  
  return JSON.stringify(canonical);
}

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * SHA-256 hash using Web Crypto API
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(buffer);
  view.set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Hash capability payload for signing
 */
export async function hashCapabilityPayload(payload: CapabilityPayload): Promise<Uint8Array> {
  const canonical = canonicalizeCapabilityPayload(payload);
  const canonicalBytes = new TextEncoder().encode(canonical);
  return sha256(canonicalBytes);
}

// ============================================================================
// Byte Conversion Utilities
// ============================================================================

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new Error('hexToBytes: input must be a string');
  }
  const cleanHex = hex.replace(/^0x/i, '').replace(/\s/g, '');
  if (cleanHex.length === 0) {
    return new Uint8Array(0);
  }
  if (cleanHex.length % 2 !== 0) {
    throw new Error(`hexToBytes: invalid hex string length (${cleanHex.length} chars, must be even)`);
  }
  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('hexToBytes: invalid hex characters detected');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify ed25519 signature using Web Crypto API
 * 
 * @param signature - 64-byte ed25519 signature (hex)
 * @param message - Message that was signed (Uint8Array)
 * @param publicKey - 32-byte ed25519 public key (hex)
 * @returns true if signature is valid
 */
export async function verifyEd25519Signature(
  signature: string,
  message: Uint8Array,
  publicKey: string
): Promise<boolean> {
  try {
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(publicKey);
    
    // Validate lengths
    if (signatureBytes.length !== 64) {
      console.warn('[Crypto] Invalid signature length:', signatureBytes.length);
      return false;
    }
    if (publicKeyBytes.length !== 32) {
      console.warn('[Crypto] Invalid public key length:', publicKeyBytes.length);
      return false;
    }
    
    // Create proper ArrayBuffers (not SharedArrayBuffer)
    const keyBuffer = new ArrayBuffer(publicKeyBytes.length);
    new Uint8Array(keyBuffer).set(publicKeyBytes);
    
    // Import public key for Ed25519 verification
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    
    // Create proper ArrayBuffers for verification
    const sigBuffer = new ArrayBuffer(signatureBytes.length);
    new Uint8Array(sigBuffer).set(signatureBytes);
    
    const msgBuffer = new ArrayBuffer(message.length);
    new Uint8Array(msgBuffer).set(message);
    
    // Verify signature
    return await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      sigBuffer,
      msgBuffer
    );
  } catch (error) {
    // Ed25519 might not be supported in all browsers
    // Fall back to tweetnacl if available
    console.warn('[Crypto] Web Crypto Ed25519 verification failed, trying fallback:', error);
    return verifyEd25519Fallback(signature, message, publicKey);
  }
}

/**
 * Fallback verification using tweetnacl-compatible approach
 * This is used when Web Crypto doesn't support Ed25519
 */
async function verifyEd25519Fallback(
  signature: string,
  message: Uint8Array,
  publicKey: string
): Promise<boolean> {
  try {
    // Dynamic import to avoid bundling if not needed
    const nacl = await import('tweetnacl');
    
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(publicKey);
    
    return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('[Crypto] Fallback verification failed:', error);
    return false;
  }
}

// ============================================================================
// Capability Verification
// ============================================================================

/**
 * Verify a signed capability's cryptographic integrity
 * 
 * Checks:
 * 1. Signature is valid for the canonical payload
 * 2. issuerPubKey matches the signing key
 * 
 * @param capability - Signed capability to verify
 * @returns true if cryptographically valid
 */
export async function verifyCapabilitySignature(capability: Capability): Promise<boolean> {
  try {
    // Extract payload (without id, issuerPubKey, signature)
    const payload: CapabilityPayload = {
      version: capability.version,
      circle: capability.circle,
      methods: capability.methods,
      scope: capability.scope,
      encrypted: capability.encrypted,
      appOrigin: capability.appOrigin,
      issuedAt: capability.issuedAt,
      expiresAt: capability.expiresAt,
      nonce: capability.nonce
    };
    
    // Hash the canonical payload
    const digest = await hashCapabilityPayload(payload);
    
    // Verify signature
    return await verifyEd25519Signature(
      capability.signature,
      digest,
      capability.issuerPubKey
    );
  } catch (error) {
    console.error('[Crypto] Capability verification error:', error);
    return false;
  }
}

/**
 * Validate capability is not expired
 */
export function isCapabilityExpired(capability: Capability): boolean {
  return Date.now() > capability.expiresAt;
}

/**
 * Validate capability origin matches current origin
 */
export function isOriginValid(capability: Capability, currentOrigin: string): boolean {
  return capability.appOrigin === currentOrigin;
}

/**
 * Full capability validation
 * 
 * Checks:
 * 1. Signature is cryptographically valid
 * 2. Capability is not expired
 * 3. Origin matches (if provided)
 */
export async function validateCapability(
  capability: Capability,
  currentOrigin?: string
): Promise<{ valid: boolean; error?: string }> {
  // Check expiry first (fast check)
  if (isCapabilityExpired(capability)) {
    return { valid: false, error: 'Capability expired' };
  }
  
  // Check origin if provided
  if (currentOrigin && !isOriginValid(capability, currentOrigin)) {
    return { valid: false, error: `Origin mismatch: expected ${capability.appOrigin}, got ${currentOrigin}` };
  }
  
  // Verify signature (slower, crypto operation)
  const signatureValid = await verifyCapabilitySignature(capability);
  if (!signatureValid) {
    return { valid: false, error: 'Invalid signature' };
  }
  
  return { valid: true };
}

// ============================================================================
// Nonce Generation
// ============================================================================

/**
 * Generate a cryptographically secure nonce
 * Format: UUID-like string for readability
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
