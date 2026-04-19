/**
 * Stealth Scan Service
 *
 * Native TypeScript implementation matching webcli C++ logic exactly:
 *
 * 1. RPC octra_stealthOutputs(0) → list of all stealth outputs
 * 2. derive_view_keypair(ed_sk[64]) → Curve25519 view keypair
 *    ed25519_sk_to_curve25519: hash(ed_sk[0..31]) → clamp → x_sk
 *    x_pk = scalarmult_base(x_sk)
 * 3. For each unclaimed output:
 *    shared = sha256(scalarmult(x_sk, eph_pub))   ← ecdh_shared_secret
 *    tag    = sha256(shared || "OCTRA_STEALTH_TAG_V1")[0..15]
 *    if hex(tag) !== output.stealth_tag → skip
 *    decrypt enc_amount (AES-256-GCM, 68 bytes: 12 nonce + 40 ct + 16 tag)
 *    claim_secret = sha256(shared || "OCTRA_CLAIM_SECRET_V1")
 */

import nacl from 'tweetnacl';
import { makeRpcCall } from './rpcHelper';

// ─── helpers ─────────────────────────────────────────────────────────────────

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

// ─── Key derivation — matches webcli derive_view_keypair ─────────────────────

/**
 * Convert Ed25519 secret key (64 bytes) to Curve25519 secret key (32 bytes).
 * Webcli: ed25519_sk_to_curve25519 → crypto_hash(ed_sk[0..31]) → clamp
 */
async function ed25519SkToCurve25519(edSk64: Uint8Array): Promise<Uint8Array> {
  // hash the 32-byte seed (first half of ed sk)
  const h = await sha256(edSk64.slice(0, 32));
  // Curve25519 clamping
  h[0] &= 248;
  h[31] &= 127;
  h[31] |= 64;
  return h;
}

/**
 * Derive Curve25519 view keypair from Ed25519 sk[64].
 * Returns { viewSk: Uint8Array(32), viewPk: Uint8Array(32) }
 */
async function deriveViewKeypair(edSk64: Uint8Array): Promise<{ viewSk: Uint8Array; viewPk: Uint8Array }> {
  const viewSk = await ed25519SkToCurve25519(edSk64);
  const viewPk = nacl.scalarMult.base(viewSk);
  return { viewSk, viewPk };
}

// ─── ECDH — matches webcli ecdh_shared_secret ────────────────────────────────

/**
 * ECDH shared secret: sha256(scalarmult(our_sk, their_pub))
 */
async function ecdhSharedSecret(ourSk: Uint8Array, theirPub: Uint8Array): Promise<Uint8Array> {
  const raw = nacl.scalarMult(ourSk, theirPub);
  return sha256(raw);
}

// ─── Stealth tag — matches webcli compute_stealth_tag ────────────────────────

async function computeStealthTag(shared: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('OCTRA_STEALTH_TAG_V1');
  const buf = new Uint8Array(shared.length + domain.length);
  buf.set(shared);
  buf.set(domain, shared.length);
  const h = await sha256(buf);
  return h.slice(0, 16); // first 16 bytes
}

// ─── Claim secret — matches webcli compute_claim_secret ──────────────────────

async function computeClaimSecret(shared: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('OCTRA_CLAIM_SECRET_V1');
  const buf = new Uint8Array(shared.length + domain.length);
  buf.set(shared);
  buf.set(domain, shared.length);
  return sha256(buf);
}

// ─── Decrypt stealth amount — matches webcli decrypt_stealth_amount ──────────

/**
 * Decrypt enc_amount (base64, 68 bytes: 12 nonce + 40 ciphertext + 16 GCM tag).
 * Plaintext layout: amount(8 bytes LE) + blinding(32 bytes)
 */
async function decryptStealthAmount(
  shared: Uint8Array,
  encB64: string,
): Promise<{ amount: bigint; blinding: Uint8Array } | null> {
  const raw = decodeBase64(encB64);
  if (raw.length !== 68) return null;

  const nonce = raw.slice(0, 12);
  const ciphertext = raw.slice(12, 52);
  const tag = raw.slice(52, 68);

  // AES-256-GCM decrypt
  const key = await crypto.subtle.importKey('raw', shared, { name: 'AES-GCM' }, false, ['decrypt']);
  // Combine ciphertext + tag (WebCrypto expects them concatenated)
  const ctWithTag = new Uint8Array(ciphertext.length + tag.length);
  ctWithTag.set(ciphertext);
  ctWithTag.set(tag, ciphertext.length);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ctWithTag);
  } catch {
    return null;
  }

  const plain = new Uint8Array(plaintext);
  if (plain.length < 40) return null;

  // amount: 8 bytes little-endian
  let amount = 0n;
  for (let i = 0; i < 8; i++) amount |= BigInt(plain[i]) << BigInt(i * 8);

  const blinding = plain.slice(8, 40);
  return { amount, blinding };
}

// ─── Resolve Ed25519 sk[64] from seed (32 bytes) or full sk (64 bytes) ───────

function resolveEd25519Sk64(seedOrSkB64: string): Uint8Array {
  const raw = decodeBase64(seedOrSkB64);
  if (raw.length === 64) return raw;
  if (raw.length === 32) {
    const kp = nacl.sign.keyPair.fromSeed(raw);
    return kp.secretKey; // 64 bytes
  }
  throw new Error(`Invalid key length: ${raw.length}`);
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ClaimableTransfer {
  id: string;
  amount: number;       // OCT (divided by 1_000_000)
  amountRaw: bigint;    // micro-OCT
  epoch: number;
  sender: string;
  txHash: string;
  claimSecret: string;  // hex
  blinding: string;     // base64
  rawOutput: any;       // full output from RPC for claim
}

// ─── Main scan function ───────────────────────────────────────────────────────

/**
 * Scan all stealth outputs and return those claimable by this wallet.
 * Matches webcli /api/stealth/scan handler exactly.
 */
export async function scanStealthOutputs(
  seedOrSkB64: string,
): Promise<ClaimableTransfer[]> {
  // 1. Fetch all stealth outputs from node
  const result = await makeRpcCall('octra_stealthOutputs', [0]);
  if (!result || typeof result !== 'object') return [];

  const outputs: any[] = (result as any).outputs ?? [];
  if (!Array.isArray(outputs) || outputs.length === 0) return [];

  // 2. Derive view keypair
  const edSk64 = resolveEd25519Sk64(seedOrSkB64);
  const { viewSk } = await deriveViewKeypair(edSk64);

  const claimable: ClaimableTransfer[] = [];

  // 3. Scan each unclaimed output
  for (const out of outputs) {
    if (out.claimed && out.claimed !== 0) continue;

    try {
      const ephB64: string = out.eph_pub;
      if (!ephB64) continue;
      const ephRaw = decodeBase64(ephB64);
      if (ephRaw.length !== 32) continue;

      // ECDH
      const shared = await ecdhSharedSecret(viewSk, ephRaw);

      // Compute and compare stealth tag
      const myTag = await computeStealthTag(shared);
      const myTagHex = hexEncode(myTag);
      if (myTagHex !== (out.stealth_tag ?? '')) continue;

      // Decrypt amount
      const dec = await decryptStealthAmount(shared, out.enc_amount ?? '');
      if (!dec) continue;

      // Compute claim secret
      const cs = await computeClaimSecret(shared);

      const id = out.id !== undefined
        ? (typeof out.id === 'string' ? out.id : String(out.id))
        : '';

      claimable.push({
        id,
        amount: Number(dec.amount) / 1_000_000,
        amountRaw: dec.amount,
        epoch: out.epoch_id ?? 0,
        sender: out.sender_addr ?? '',
        txHash: out.tx_hash ?? '',
        claimSecret: hexEncode(cs),
        blinding: encodeBase64(dec.blinding),
        rawOutput: out,
      });
    } catch {
      continue;
    }
  }

  return claimable;
}
