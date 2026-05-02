// Cryptographic operations for capability signing and verification.
// Curve: ed25519 | Hash: SHA-256 | Encoding: UTF-8

import type { Capability, CapabilityPayload } from './types';
import {
  canonicalizeCapability,
  OCTRA_CAPABILITY_PREFIX,
} from './canonical';

/** @deprecated Use canonicalizeCapability from canonical.ts instead. */
export function canonicalizeCapabilityPayload(payload: CapabilityPayload): string {
  return canonicalizeCapability(payload);
}

// ============================================================================
// Hash Functions
// ============================================================================

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

export async function hashCapabilityPayload(payload: CapabilityPayload): Promise<Uint8Array> {
  const canonical = canonicalizeCapability(payload);
  const withDomain = OCTRA_CAPABILITY_PREFIX + canonical;
  return sha256(new TextEncoder().encode(withDomain));
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') throw new Error('hexToBytes: input must be a string');

  const cleanHex = hex.replace(/^0x/i, '').replace(/\s/g, '');
  if (cleanHex.length === 0) return new Uint8Array(0);
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

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyEd25519Signature(
  signature: string,
  message: Uint8Array,
  publicKey: string,
): Promise<boolean> {
  try {
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(publicKey);

    if (signatureBytes.length !== 64) {
      console.warn('[Crypto] Invalid signature length:', signatureBytes.length);
      return false;
    }
    if (publicKeyBytes.length !== 32) {
      console.warn('[Crypto] Invalid public key length:', publicKeyBytes.length);
      return false;
    }

    const keyBuffer = new ArrayBuffer(publicKeyBytes.length);
    new Uint8Array(keyBuffer).set(publicKeyBytes);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const sigBuffer = new ArrayBuffer(signatureBytes.length);
    new Uint8Array(sigBuffer).set(signatureBytes);

    const msgBuffer = new ArrayBuffer(message.length);
    new Uint8Array(msgBuffer).set(message);

    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBuffer, msgBuffer);
  } catch (error) {
    console.warn('[Crypto] Web Crypto Ed25519 verification failed, trying fallback:', error);
    return verifyEd25519Fallback(signature, message, publicKey);
  }
}

async function verifyEd25519Fallback(
  signature: string,
  message: Uint8Array,
  publicKey: string,
): Promise<boolean> {
  try {
    const nacl = await import('tweetnacl');
    return nacl.sign.detached.verify(message, hexToBytes(signature), hexToBytes(publicKey));
  } catch (error) {
    console.error('[Crypto] Fallback verification failed:', error);
    return false;
  }
}

export async function verifyCapabilitySignature(capability: Capability): Promise<boolean> {
  try {
    const payload: CapabilityPayload = {
      version: capability.version,
      circle: capability.circle,
      methods: capability.methods,
      scope: capability.scope,
      encrypted: capability.encrypted,
      appOrigin: capability.appOrigin,
      issuedAt: capability.issuedAt,
      expiresAt: capability.expiresAt,
      nonceBase: capability.nonceBase,
      branchId: capability.branchId,
      epoch: capability.epoch,
    };

    const digest = await hashCapabilityPayload(payload);
    return verifyEd25519Signature(capability.signature, digest, capability.walletPubKey);
  } catch (error) {
    console.error('[Crypto] Capability verification error:', error);
    return false;
  }
}

export function isCapabilityExpired(capability: Capability): boolean {
  return Date.now() > capability.expiresAt;
}

export function isOriginValid(capability: Capability, currentOrigin: string): boolean {
  return capability.appOrigin === currentOrigin;
}

export async function validateCapability(
  capability: Capability,
  currentOrigin?: string,
): Promise<{ valid: boolean; error?: string }> {
  if (isCapabilityExpired(capability)) {
    return { valid: false, error: 'Capability expired' };
  }

  if (currentOrigin && !isOriginValid(capability, currentOrigin)) {
    return {
      valid: false,
      error: `Origin mismatch: expected ${capability.appOrigin}, got ${currentOrigin}`,
    };
  }

  const signatureValid = await verifyCapabilitySignature(capability);
  if (!signatureValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Synchronous djb2-based origin binding hash. Not for capability signing. */
export function domainSeparator(params: {
  circleId: string;
  origin: string;
  epoch: number;
  branchId: string;
  capabilityId: string;
  method: string;
  nonce: number;
}): string {
  const combined = [
    'OCTRA_DOMAIN_V2',
    params.circleId,
    params.origin,
    params.epoch.toString(),
    params.branchId,
    params.capabilityId,
    params.method,
    params.nonce.toString(),
  ].join('||');

  const bytes = new TextEncoder().encode(combined);
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) - hash) + bytes[i];
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

export function verifyDomainSeparation(
  hash: string,
  params: Parameters<typeof domainSeparator>[0],
): boolean {
  return hash === domainSeparator(params);
}

export async function deriveSessionKey(
  walletSecret: Uint8Array,
  circleId: string,
  origin: string,
  epoch: number,
): Promise<Uint8Array> {
  const info = `OCTRA_SESSION||${circleId}||${origin}||${epoch}`;
  const infoBytes = new TextEncoder().encode(info);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buffer = new ArrayBuffer(walletSecret.length);
      new Uint8Array(buffer).set(walletSecret);

      const key = await crypto.subtle.importKey('raw', buffer, { name: 'HKDF' }, false, ['deriveBits']);

      const infoBuffer = new ArrayBuffer(infoBytes.length);
      new Uint8Array(infoBuffer).set(infoBytes);

      const derivedBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: infoBuffer },
        key,
        256,
      );

      return new Uint8Array(derivedBits);
    } catch {
      return new Uint8Array(32);
    }
  }

  return new Uint8Array(32);
}
