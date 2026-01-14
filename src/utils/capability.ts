/**
 * Capability Signing Utilities
 * 
 * Implements Octra capability signing according to:
 * packages/octra_capability_sdk_deterministic_test_vectors.md
 * 
 * - Curve: ed25519
 * - Hash: SHA-256
 * - Encoding: UTF-8
 * - Canonicalization: strict JSON with sorted keys & arrays
 */

import * as nacl from 'tweetnacl';

// Capability payload interface
export interface CapabilityPayload {
  version: number;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  appOrigin: string;
  issuedAt: number;
  expiresAt?: number;
  nonce: string;
}

// Signed capability interface
export interface SignedCapability extends CapabilityPayload {
  issuerPubKey: string;
  signature: string;
}

/**
 * Canonicalize capability payload for signing
 * Rules:
 * - Keys MUST be sorted lexicographically
 * - No extra whitespace
 * - No undefined/null fields
 * - methods[] MUST be sorted lexicographically
 */
export function canonicalizeCapability(payload: CapabilityPayload): string {
  // Sort methods array
  const sortedMethods = [...payload.methods].sort();
  
  // Build canonical object with sorted keys
  const canonical: Record<string, unknown> = {};
  
  // Add fields in lexicographic order
  canonical.appOrigin = payload.appOrigin;
  canonical.circle = payload.circle;
  canonical.encrypted = payload.encrypted;
  if (payload.expiresAt !== undefined) {
    canonical.expiresAt = payload.expiresAt;
  }
  canonical.issuedAt = payload.issuedAt;
  canonical.methods = sortedMethods;
  canonical.nonce = payload.nonce;
  canonical.scope = payload.scope;
  canonical.version = payload.version;
  
  return JSON.stringify(canonical);
}

/**
 * SHA-256 hash function
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Create a copy to ensure we have a proper ArrayBuffer
  const buffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(buffer);
  view.set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  // Handle URL-safe base64 and padding
  let cleanBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (cleanBase64.length % 4 !== 0) {
    cleanBase64 += '=';
  }
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Check if string is valid hex
 */
function isHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str.replace(/\s/g, ''));
}

/**
 * Check if string is valid base64
 */
function isBase64(str: string): boolean {
  try {
    // Try to decode and check if it produces valid bytes
    const decoded = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return decoded.length > 0;
  } catch {
    return false;
  }
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a unique nonce for capability
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Format as UUID-like string
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Sign a capability payload with ed25519
 * 
 * @param payload - Capability payload to sign
 * @param privateKey - Private key (base64 or hex format, 32 bytes seed)
 * @returns Signed capability with issuerPubKey and signature
 */
export async function signCapability(
  payload: CapabilityPayload,
  privateKey: string
): Promise<SignedCapability> {
  console.log('[Capability] signCapability called');
  
  // Validate private key input
  if (!privateKey) {
    throw new Error('Private key is required but was empty or undefined');
  }
  
  if (typeof privateKey !== 'string') {
    throw new Error(`Private key must be a string, got ${typeof privateKey}`);
  }
  
  console.log('[Capability] Private key input length:', privateKey.length, 'chars');
  console.log('[Capability] Private key preview:', privateKey.slice(0, 8) + '...' + privateKey.slice(-4));
  
  // Get canonical form
  const canonical = canonicalizeCapability(payload);
  console.log('[Capability] Canonical form:', canonical);
  
  // Hash the canonical form
  const canonicalBytes = new TextEncoder().encode(canonical);
  const digest = await sha256(canonicalBytes);
  console.log('[Capability] SHA-256 digest:', bytesToHex(digest));
  
  // Convert private key to bytes - detect format (base64 or hex)
  let privateKeyBytes: Uint8Array;
  
  // Try base64 first (Octra wallet default format)
  if (isBase64(privateKey)) {
    try {
      privateKeyBytes = base64ToBytes(privateKey);
      console.log('[Capability] Private key format: base64, decoded length:', privateKeyBytes.length, 'bytes');
    } catch (e) {
      console.error('[Capability] Base64 decode failed:', e);
      throw new Error(`Failed to decode base64 private key: ${e}`);
    }
  } else if (isHex(privateKey)) {
    // Hex format
    privateKeyBytes = hexToBytes(privateKey);
    console.log('[Capability] Private key format: hex, decoded length:', privateKeyBytes.length, 'bytes');
  } else {
    console.error('[Capability] Invalid key format. Not base64 or hex.');
    console.error('[Capability] Key sample:', privateKey.slice(0, 20));
    throw new Error('Invalid private key format: must be base64 or hex');
  }
  
  // Handle different private key lengths:
  // - 32 bytes: seed only (use fromSeed)
  // - 64 bytes: full secret key (seed + public key, extract first 32 bytes)
  let keyPair: nacl.SignKeyPair;
  
  try {
    if (privateKeyBytes.length === 32) {
      // 32-byte seed - create keypair from seed
      console.log('[Capability] Creating keypair from 32-byte seed');
      keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes);
      console.log('[Capability] Keypair created successfully');
    } else if (privateKeyBytes.length === 64) {
      // 64-byte secret key - extract seed (first 32 bytes) and create keypair
      console.log('[Capability] Extracting seed from 64-byte key');
      const seed = privateKeyBytes.slice(0, 32);
      keyPair = nacl.sign.keyPair.fromSeed(seed);
      console.log('[Capability] Keypair created from 64-byte key');
    } else {
      // Try to hash the key to get 32 bytes if it's in a different format
      console.log('[Capability] Non-standard key length:', privateKeyBytes.length, ', hashing to 32 bytes');
      const hashedKey = await sha256(privateKeyBytes);
      keyPair = nacl.sign.keyPair.fromSeed(hashedKey);
      console.log('[Capability] Keypair created from hashed key');
    }
  } catch (e) {
    console.error('[Capability] Failed to create keypair:', e);
    console.error('[Capability] Key bytes length:', privateKeyBytes.length);
    throw new Error(`Failed to create keypair from private key: ${e}`);
  }
  
  // Sign the digest
  console.log('[Capability] Signing digest...');
  const signature = nacl.sign.detached(digest, keyPair.secretKey);
  
  // Get public key hex
  const issuerPubKey = bytesToHex(keyPair.publicKey);
  const signatureHex = bytesToHex(signature);
  
  console.log('[Capability] Public key:', issuerPubKey);
  console.log('[Capability] Signature:', signatureHex);
  
  // Return signed capability with sorted methods
  return {
    ...payload,
    methods: [...payload.methods].sort(),
    issuerPubKey,
    signature: signatureHex
  };
}

/**
 * Verify a signed capability
 * 
 * @param capability - Signed capability to verify
 * @returns true if signature is valid
 */
export async function verifyCapability(capability: SignedCapability): Promise<boolean> {
  try {
    // Extract payload (without issuerPubKey and signature)
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
    
    // Get canonical form and hash
    const canonical = canonicalizeCapability(payload);
    const canonicalBytes = new TextEncoder().encode(canonical);
    const digest = await sha256(canonicalBytes);
    
    // Convert signature and public key from hex
    const signatureBytes = hexToBytes(capability.signature);
    const publicKeyBytes = hexToBytes(capability.issuerPubKey);
    
    // Verify signature
    return nacl.sign.detached.verify(digest, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('[Capability] Verification error:', error);
    return false;
  }
}

/**
 * Check if capability is expired
 */
export function isCapabilityExpired(capability: SignedCapability): boolean {
  if (!capability.expiresAt) return false;
  return Date.now() > capability.expiresAt;
}

/**
 * Check if method is allowed by capability
 */
export function isMethodAllowed(capability: SignedCapability, method: string): boolean {
  return capability.methods.includes(method);
}

/**
 * Create a capability ID from the capability data
 */
export function createCapabilityId(capability: SignedCapability): string {
  // Use first 16 chars of signature as ID
  return `cap-${capability.signature.slice(0, 16)}`;
}
