/**
 * Encrypted Balance Service
 *
 * Native TypeScript implementation matching webcli C++ logic exactly:
 *
 * 1. sign_balance_request():
 *    msg = "octra_encryptedBalance|" + address
 *    sig = ed25519_sign_detached(msg, sk[64])   → base64
 *
 * 2. RPC call: octra_encryptedBalance(addr, sig_b64, pub_b64)
 *    → { cipher: "hfhe_v1|<base64>" | "0" }
 *
 * Key format notes:
 *   - Main project stores 32-byte seed (base64)
 *   - Ed25519 signing needs 64-byte secret key
 *   - nacl.sign.keyPair.fromSeed(seed32) → { secretKey: 64, publicKey: 32 }
 *   - pub_b64 = base64(publicKey[32])  ← same as webcli's w.pub_b64
 */

import nacl from 'tweetnacl';

// ============================================================================
// Constants
// ============================================================================

const HFHE_PREFIX = 'hfhe_v1|';
const BALANCE_REQUEST_PREFIX = 'octra_encryptedBalance|';

// ============================================================================
// Types
// ============================================================================

export interface EncryptedBalanceResult {
  cipher: string;   // raw cipher string from RPC ("0" | "hfhe_v1|...")
  raw: string;      // same as cipher, kept for compat
}

// ============================================================================
// Base64 helpers (no external deps)
// ============================================================================

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

// ============================================================================
// Key helpers
// ============================================================================

/**
 * Convert 32-byte seed (base64) → Ed25519 keypair
 * Matches webcli: keypair_from_seed() → crypto_sign_seed_keypair()
 */
function seedToKeyPair(seedBase64: string): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const seed = decodeBase64(seedBase64);

  if (seed.length === 64) {
    // Already a full 64-byte secret key (sk[0..31] = seed, sk[32..63] = pubkey)
    return {
      secretKey: seed,
      publicKey: seed.slice(32),
    };
  }

  if (seed.length !== 32) {
    throw new Error(`Invalid seed length: expected 32 bytes, got ${seed.length}`);
  }

  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { secretKey: kp.secretKey, publicKey: kp.publicKey };
}

// ============================================================================
// Signing — matches webcli sign_balance_request()
// ============================================================================

/**
 * Sign the balance request message.
 * Webcli: msg = "octra_encryptedBalance|" + addr
 *         sig = ed25519_sign_detached(msg, sk[64])
 */
function signBalanceRequest(address: string, secretKey: Uint8Array): string {
  const msg = new TextEncoder().encode(BALANCE_REQUEST_PREFIX + address);
  const sig = nacl.sign.detached(msg, secretKey);
  return encodeBase64(sig);
}

// ============================================================================
// RPC call — matches webcli rpc_client.hpp get_encrypted_balance()
// ============================================================================

/**
 * Call octra_encryptedBalance via JSON-RPC 2.0.
 *
 * Uses makeAPIRequest (imported lazily to avoid circular deps) so the
 * request is correctly routed through the extension/dev/prod proxy — same
 * as every other RPC call in the project.
 *
 * Webcli equivalent:
 *   rpc.call("octra_encryptedBalance", {addr, sig_b64, pub_b64})
 */
async function rpcGetEncryptedBalance(
  address: string,
  signatureB64: string,
  publicKeyB64: string,
): Promise<string> {
  // Lazy import to avoid circular dependency with api.ts
  const { makeRpcCall } = await import('./rpcHelper');

  const result = await makeRpcCall('octra_encryptedBalance', [address, signatureB64, publicKeyB64]);

  if (result === null || result === undefined) return '0';

  // result shape: { address, cipher, has_pvac_pubkey }
  if (typeof result === 'object' && 'cipher' in result) {
    const cipher = (result as any).cipher;
    return (cipher === null || cipher === undefined) ? '0' : String(cipher);
  }

  return '0';
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch encrypted balance cipher from node.
 *
 * Flow (identical to webcli get_encrypted_balance()):
 *   1. seed → keypair
 *   2. sign "octra_encryptedBalance|{addr}" with sk[64]
 *   3. RPC octra_encryptedBalance(addr, sig, pub) → cipher
 *
 * @param address    - wallet address (e.g. "oct1abc...")
 * @param seedBase64 - 32-byte seed OR 64-byte sk, base64 encoded
 * @param _rpcUrl    - kept for API compat, routing handled internally
 */
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

// ============================================================================
// Utilities
// ============================================================================
