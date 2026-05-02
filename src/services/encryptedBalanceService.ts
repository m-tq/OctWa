/**
 * Encrypted Balance Service
 *
 * Matches webcli C++ logic:
 *   msg = "octra_encryptedBalance|" + address
 *   sig = ed25519_sign_detached(msg, sk[64]) → base64
 *   RPC: octra_encryptedBalance(addr, sig_b64, pub_b64) → { cipher }
 */

import nacl from 'tweetnacl';

const BALANCE_REQUEST_PREFIX = 'octra_encryptedBalance|';

export interface EncryptedBalanceResult {
  cipher: string;
  raw: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function seedToKeyPair(seedBase64: string): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const seed = decodeBase64(seedBase64);

  if (seed.length === 64) {
    return { secretKey: seed, publicKey: seed.slice(32) };
  }
  if (seed.length !== 32) {
    throw new Error(`Invalid seed length: expected 32 bytes, got ${seed.length}`);
  }

  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { secretKey: kp.secretKey, publicKey: kp.publicKey };
}

function signBalanceRequest(address: string, secretKey: Uint8Array): string {
  const msg = new TextEncoder().encode(BALANCE_REQUEST_PREFIX + address);
  return encodeBase64(nacl.sign.detached(msg, secretKey));
}

async function rpcGetEncryptedBalance(
  address: string,
  signatureB64: string,
  publicKeyB64: string,
): Promise<string> {
  const { makeRpcCall } = await import('./rpcHelper');
  const result = await makeRpcCall('octra_encryptedBalance', [address, signatureB64, publicKeyB64]);

  if (result === null || result === undefined) return '0';

  if (typeof result === 'object' && 'cipher' in result) {
    const cipher = (result as Record<string, unknown>).cipher;
    return cipher === null || cipher === undefined ? '0' : String(cipher);
  }

  return '0';
}

export async function fetchEncryptedBalanceFromNode(
  address: string,
  seedBase64: string,
  _rpcUrl?: string,
): Promise<EncryptedBalanceResult> {
  const { secretKey, publicKey } = seedToKeyPair(seedBase64);
  const sig = signBalanceRequest(address, secretKey);
  const pubB64 = encodeBase64(publicKey);
  const cipher = await rpcGetEncryptedBalance(address, sig, pubB64);

  return { cipher, raw: cipher };
}
