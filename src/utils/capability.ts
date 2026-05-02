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

// Capability payload interface v2
export interface CapabilityPayload {
  version: 2;
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  appOrigin: string;
  branchId: string;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
  nonceBase: number;
}

// Signed capability interface
export interface SignedCapability extends CapabilityPayload {
  walletPubKey: string;
  signature: string;
}

/**
 * Canonicalize capability payload for signing v2
 * Rules:
 * - Keys MUST be sorted lexicographically
 * - No extra whitespace
 * - No undefined/null fields
 * - methods[] MUST be sorted lexicographically
 */
function canonicalizeCapability(payload: CapabilityPayload): string {
  const sortedMethods = [...payload.methods].sort();
  
  const canonical: Record<string, unknown> = {};
  
  canonical.appOrigin = payload.appOrigin;
  canonical.branchId = payload.branchId;
  canonical.circle = payload.circle;
  canonical.encrypted = payload.encrypted;
  canonical.epoch = payload.epoch;
  canonical.expiresAt = payload.expiresAt;
  canonical.issuedAt = payload.issuedAt;
  canonical.methods = sortedMethods;
  canonical.nonceBase = payload.nonceBase;
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
function hexToBytes(hex: string): Uint8Array {
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
function base64ToBytes(base64: string): Uint8Array {
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
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate nonce base for capability v2
 */
export function generateNonceBase(): number {
  return 0;
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

  // Validate private key input
  if (!privateKey) {
    throw new Error('Private key is required but was empty or undefined');
  }
  
  if (typeof privateKey !== 'string') {
    throw new Error(`Private key must be a string, got ${typeof privateKey}`);
  }
  
  // SECURITY: Do not log private key details

  // Get canonical form
  const canonical = canonicalizeCapability(payload);
  
  // Hash the canonical form
  const canonicalBytes = new TextEncoder().encode(canonical);
  const digest = await sha256(canonicalBytes);
  
  // Convert private key to bytes - detect format (base64 or hex)
  let privateKeyBytes: Uint8Array;
  
  // Try base64 first (Octra wallet default format)
  if (isBase64(privateKey)) {
    try {
      privateKeyBytes = base64ToBytes(privateKey);
    } catch (e) {
      throw new Error(`Failed to decode base64 private key: ${e}`);
    }
  } else if (isHex(privateKey)) {
    // Hex format
    privateKeyBytes = hexToBytes(privateKey);
  } else {
    throw new Error('Invalid private key format: must be base64 or hex');
  }
  
  // Handle different private key lengths:
  // - 32 bytes: seed only (use fromSeed)
  // - 64 bytes: full secret key (seed + public key, extract first 32 bytes)
  let keyPair: nacl.SignKeyPair;
  
  try {
    if (privateKeyBytes.length === 32) {
      // 32-byte seed - create keypair from seed
      keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes);
    } else if (privateKeyBytes.length === 64) {
      // 64-byte secret key - extract seed (first 32 bytes) and create keypair
      const seed = privateKeyBytes.slice(0, 32);
      keyPair = nacl.sign.keyPair.fromSeed(seed);
    } else {
      // Try to hash the key to get 32 bytes if it's in a different format
      const hashedKey = await sha256(privateKeyBytes);
      keyPair = nacl.sign.keyPair.fromSeed(hashedKey);
    }
  } catch (e) {
    throw new Error(`Failed to create keypair from private key: ${e}`);
  }
  
  // Sign the digest
  const signature = nacl.sign.detached(digest, keyPair.secretKey);
  
  // Get public key hex
  const issuerPubKey = bytesToHex(keyPair.publicKey);
  const signatureHex = bytesToHex(signature);

  return {
    ...payload,
    methods: [...payload.methods].sort(),
    walletPubKey: issuerPubKey,
    signature: signatureHex
  };
}

/**
 * Verify a signed capability
 * @deprecated Not yet implemented — placeholder for future verification logic.
 */

/**
 * Derive a short capability ID from the first 16 hex chars of its signature.
 */
export function createCapabilityId(capability: SignedCapability): string {
  return `cap-${capability.signature.slice(0, 16)}`;
}
