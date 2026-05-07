/**
 * Low-level crypto primitives used by the browser PVAC engine.
 *
 * All functions use the Web Crypto API or tweetnacl — no OpenSSL dependency.
 * Mirrors the C++ helpers in crypto_utils.hpp and stealth.hpp.
 */

import nacl from 'tweetnacl'
import type { Transaction } from '@/types/wallet'

// ─── Encoding helpers ─────────────────────────────────────────────────────────

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function decodeHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Convert hex public key to base64 (matches hexToBase64 in pvacServerService). */
export function hexPubkeyToBase64(hexOrBase64: string): string {
  if (/^[0-9a-fA-F]+$/.test(hexOrBase64.replace(/^0x/i, ''))) {
    return encodeBase64(decodeHex(hexOrBase64))
  }
  return hexOrBase64
}

// ─── Key derivation ───────────────────────────────────────────────────────────

/**
 * Resolve a private key to a 64-byte Ed25519 secret key.
 * Accepts either a 32-byte seed (base64) or a 64-byte sk (base64).
 */
export function resolveSecretKey64(privateKeyB64: string): Uint8Array {
  const raw = decodeBase64(privateKeyB64)

  if (raw.length === 64) return raw

  if (raw.length === 32) {
    const kp = nacl.sign.keyPair.fromSeed(raw)
    return kp.secretKey
  }

  throw new Error(`Invalid private key length: ${raw.length} bytes (expected 32 or 64)`)
}

/**
 * Derive the 32-byte seed from a private key (first 32 bytes of sk64).
 * This is the seed used for PVAC keygen.
 */
export function deriveSeed32(privateKeyB64: string): Uint8Array {
  return resolveSecretKey64(privateKeyB64).slice(0, 32)
}

/**
 * Convert Ed25519 sk (64 bytes) to Curve25519 sk (32 bytes).
 * Mirrors ed25519_sk_to_curve25519() in crypto_utils.hpp.
 */
export async function ed25519SkToCurve25519(sk64: Uint8Array): Promise<Uint8Array> {
  const h512 = await crypto.subtle.digest('SHA-512', sk64.slice(0, 32))
  const h = new Uint8Array(h512)
  h[0] &= 248
  h[31] &= 127
  h[31] |= 64
  return h.slice(0, 32)
}

/**
 * Derive Curve25519 view keypair from Ed25519 sk.
 * Mirrors derive_view_keypair() in stealth.hpp.
 */
export async function deriveViewKeypair(
  sk64: Uint8Array,
): Promise<{ viewSk: Uint8Array; viewPk: Uint8Array }> {
  const viewSk = await ed25519SkToCurve25519(sk64)
  return { viewSk, viewPk: nacl.scalarMult.base(viewSk) }
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

/** Domain-separated SHA-256: sha256(data || domain). */
async function sha256WithDomain(data: Uint8Array, domain: string): Promise<Uint8Array> {
  const domainBytes = new TextEncoder().encode(domain)
  const buf = new Uint8Array(data.length + domainBytes.length)
  buf.set(data)
  buf.set(domainBytes, data.length)
  return sha256(buf)
}

// ─── Stealth crypto ───────────────────────────────────────────────────────────

/**
 * ECDH shared secret: sha256(scalarmult(ourSk, theirPub)).
 * Mirrors ecdh_shared_secret() in stealth.hpp.
 */
export async function ecdhSharedSecret(
  ourSk: Uint8Array,
  theirPub: Uint8Array,
): Promise<Uint8Array> {
  return sha256(nacl.scalarMult(ourSk, theirPub))
}

/**
 * Compute 16-byte stealth tag from shared secret.
 * Mirrors compute_stealth_tag() in stealth.hpp.
 */
export async function computeStealthTag(shared: Uint8Array): Promise<Uint8Array> {
  return (await sha256WithDomain(shared, 'OCTRA_STEALTH_TAG_V1')).slice(0, 16)
}

/**
 * Compute 32-byte claim secret from shared secret.
 * Mirrors compute_claim_secret() in stealth.hpp.
 */
export async function computeClaimSecret(shared: Uint8Array): Promise<Uint8Array> {
  return sha256WithDomain(shared, 'OCTRA_CLAIM_SECRET_V1')
}

/**
 * Compute 32-byte claim pub from claim secret + address.
 * Mirrors compute_claim_pub() in stealth.hpp.
 */
export async function computeClaimPub(
  claimSecret: Uint8Array,
  address: string,
): Promise<Uint8Array> {
  const addrBytes = new TextEncoder().encode(address)
  const domainBytes = new TextEncoder().encode('OCTRA_CLAIM_BIND_V1')
  const buf = new Uint8Array(claimSecret.length + addrBytes.length + domainBytes.length)
  buf.set(claimSecret)
  buf.set(addrBytes, claimSecret.length)
  buf.set(domainBytes, claimSecret.length + addrBytes.length)
  return sha256(buf)
}

/**
 * AES-256-GCM encrypt stealth amount + blinding.
 * Output: base64(nonce[12] || ciphertext[40] || tag[16]) = 68 bytes.
 * Mirrors encrypt_stealth_amount() in stealth.hpp.
 */
export async function encryptStealthAmount(
  shared: Uint8Array,
  amountRaw: bigint,
  blinding: Uint8Array,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const plaintext = new Uint8Array(40)
  for (let i = 0; i < 8; i++) plaintext[i] = Number((amountRaw >> BigInt(i * 8)) & 0xffn)
  plaintext.set(blinding.slice(0, 32), 8)

  const key = await crypto.subtle.importKey('raw', shared, { name: 'AES-GCM' }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)

  const encBytes = new Uint8Array(encrypted)
  const output = new Uint8Array(68)
  output.set(nonce, 0)
  output.set(encBytes.slice(0, 40), 12)
  output.set(encBytes.slice(40), 52)

  return encodeBase64(output)
}

export interface StealthDecrypted {
  amountRaw: bigint
  blinding: Uint8Array
}

/**
 * AES-256-GCM decrypt stealth amount + blinding.
 * Mirrors decrypt_stealth_amount() in stealth.hpp.
 */
export async function decryptStealthAmount(
  shared: Uint8Array,
  encB64: string,
): Promise<StealthDecrypted | null> {
  const raw = decodeBase64(encB64)
  if (raw.length !== 68) return null

  const nonce = raw.slice(0, 12)
  const ciphertext = raw.slice(12, 52)
  const tag = raw.slice(52, 68)

  const ctWithTag = new Uint8Array(ciphertext.length + tag.length)
  ctWithTag.set(ciphertext)
  ctWithTag.set(tag, ciphertext.length)

  const key = await crypto.subtle.importKey('raw', shared, { name: 'AES-GCM' }, false, ['decrypt'])

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ctWithTag)
  } catch {
    return null
  }

  const plain = new Uint8Array(plaintext)
  if (plain.length < 40) return null

  let amountRaw = 0n
  for (let i = 0; i < 8; i++) amountRaw |= BigInt(plain[i]) << BigInt(i * 8)

  return { amountRaw, blinding: plain.slice(8, 40) }
}

// ─── Transaction signing ──────────────────────────────────────────────────────

/**
 * Ed25519 sign and return base64-encoded 64-byte signature.
 * Mirrors ed25519_sign_detached() in tx_builder.hpp.
 */
export function ed25519SignDetached(message: Uint8Array, sk64: Uint8Array): string {
  return encodeBase64(nacl.sign.detached(message, sk64))
}

/**
 * Build canonical JSON string for a transaction.
 * Field order must match canonical_json() in tx_builder.hpp exactly.
 */
export function buildCanonicalJson(tx: {
  from: string
  to_: string
  amount: string
  nonce: number
  ou: string
  timestamp: number
  op_type: string
  encrypted_data?: string
  message?: string
}): string {
  const escape = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')

  let json =
    `{"from":"${escape(tx.from)}"` +
    `,"to_":"${escape(tx.to_)}"` +
    `,"amount":"${escape(tx.amount)}"` +
    `,"nonce":${tx.nonce}` +
    `,"ou":"${escape(tx.ou)}"` +
    `,"timestamp":${tx.timestamp}` +
    `,"op_type":"${escape(tx.op_type || 'standard')}"`

  if (tx.encrypted_data) json += `,"encrypted_data":"${escape(tx.encrypted_data)}"`
  if (tx.message) json += `,"message":"${escape(tx.message)}"`

  json += '}'
  return json
}

/**
 * Build and sign a transaction object.
 * Returns the full signed tx ready for submission.
 */
export function buildAndSignTx(params: {
  from: string
  to_: string
  amount: string
  nonce: number
  ou: string
  timestamp: number
  op_type: string
  encrypted_data?: string
  message?: string
  sk64: Uint8Array
  publicKeyB64: string
}): Transaction {
  const { sk64, publicKeyB64, ...txFields } = params

  const canonical = buildCanonicalJson(txFields)
  const signature = ed25519SignDetached(new TextEncoder().encode(canonical), sk64)

  return {
    from: txFields.from,
    to_: txFields.to_,
    amount: txFields.amount,
    nonce: txFields.nonce,
    ou: txFields.ou,
    timestamp: txFields.timestamp,
    op_type: txFields.op_type,
    ...(txFields.encrypted_data ? { encrypted_data: txFields.encrypted_data } : {}),
    ...(txFields.message ? { message: txFields.message } : {}),
    signature,
    public_key: publicKeyB64,
  } as Transaction
}

// ─── PVAC pubkey registration ─────────────────────────────────────────────────

/**
 * Sign a PVAC pubkey registration request.
 * Mirrors sign_register_request() in tx_builder.hpp.
 */
export async function signRegisterRequest(
  address: string,
  pvacPubkeyBytes: Uint8Array,
  sk64: Uint8Array,
): Promise<string> {
  const pkHash = encodeHex(await sha256(pvacPubkeyBytes))
  const msg = new TextEncoder().encode(`register_pvac|${address}|${pkHash}`)
  return ed25519SignDetached(msg, sk64)
}
