/**
 * Stealth Scan Service — matches webcli C++ logic exactly.
 *
 * 1. RPC octra_stealthOutputs(0) → list of all stealth outputs
 * 2. derive_view_keypair(ed_sk[64]) → Curve25519 view keypair
 * 3. For each unclaimed output: ECDH → tag check → decrypt amount → claim secret
 */

import nacl from 'tweetnacl';
import { makeRpcCall } from './rpcHelper';

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
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** Convert Ed25519 sk (64 bytes) to Curve25519 sk (32 bytes) via SHA-512 + clamp. */
async function ed25519SkToCurve25519(edSk64: Uint8Array): Promise<Uint8Array> {
  const h512 = await crypto.subtle.digest('SHA-512', edSk64.slice(0, 32));
  const h = new Uint8Array(h512);
  h[0] &= 248;
  h[31] &= 127;
  h[31] |= 64;
  return h.slice(0, 32);
}

async function deriveViewKeypair(
  edSk64: Uint8Array,
): Promise<{ viewSk: Uint8Array; viewPk: Uint8Array }> {
  const viewSk = await ed25519SkToCurve25519(edSk64);
  return { viewSk, viewPk: nacl.scalarMult.base(viewSk) };
}

async function ecdhSharedSecret(ourSk: Uint8Array, theirPub: Uint8Array): Promise<Uint8Array> {
  return sha256(nacl.scalarMult(ourSk, theirPub));
}

async function computeStealthTag(shared: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('OCTRA_STEALTH_TAG_V1');
  const buf = new Uint8Array(shared.length + domain.length);
  buf.set(shared);
  buf.set(domain, shared.length);
  return (await sha256(buf)).slice(0, 16);
}

async function computeClaimSecret(shared: Uint8Array): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('OCTRA_CLAIM_SECRET_V1');
  const buf = new Uint8Array(shared.length + domain.length);
  buf.set(shared);
  buf.set(domain, shared.length);
  return sha256(buf);
}

/** Decrypt enc_amount (68 bytes: 12 nonce + 40 ct + 16 GCM tag). */
async function decryptStealthAmount(
  shared: Uint8Array,
  encB64: string,
): Promise<{ amount: bigint; blinding: Uint8Array } | null> {
  const raw = decodeBase64(encB64);
  if (raw.length !== 68) return null;

  const nonce = raw.slice(0, 12);
  const ciphertext = raw.slice(12, 52);
  const tag = raw.slice(52, 68);

  const key = await crypto.subtle.importKey('raw', shared, { name: 'AES-GCM' }, false, ['decrypt']);
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

  let amount = 0n;
  for (let i = 0; i < 8; i++) amount |= BigInt(plain[i]) << BigInt(i * 8);

  return { amount, blinding: plain.slice(8, 40) };
}

function resolveEd25519Sk64(seedOrSkB64: string): Uint8Array {
  const raw = decodeBase64(seedOrSkB64);
  if (raw.length === 64) return raw;
  if (raw.length === 32) return nacl.sign.keyPair.fromSeed(raw).secretKey;
  throw new Error(`Invalid key length: ${raw.length}`);
}

export interface ClaimableTransfer {
  id: string;
  amount: number;
  amountRaw: bigint;
  epoch: number;
  sender: string;
  txHash: string;
  claimSecret: string;
  blinding: string;
  rawOutput: unknown;
}

// ─── In-memory scan cache ─────────────────────────────────────────────────────
// Keyed by wallet address. Populated by background scan in WalletDashboard
// so ClaimTransfers can display results instantly without re-scanning.

interface ScanCacheEntry {
  transfers: ClaimableTransfer[];
  scannedAt: number;  // Date.now()
}

const scanCache = new Map<string, ScanCacheEntry>()
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

/** Store scan results for an address (called by WalletDashboard background scan). */
export function setCachedScanResults(address: string, transfers: ClaimableTransfer[]): void {
  scanCache.set(address, { transfers, scannedAt: Date.now() })
}

/** Get cached scan results if still fresh, or null if expired/missing. */
export function getCachedScanResults(address: string): ClaimableTransfer[] | null {
  const entry = scanCache.get(address)
  if (!entry) return null
  if (Date.now() - entry.scannedAt > SCAN_CACHE_TTL_MS) {
    scanCache.delete(address)
    return null
  }
  return entry.transfers
}

/** Invalidate cache for an address (call after a successful claim). */
export function invalidateScanCache(address: string): void {
  scanCache.delete(address)
}

export async function scanStealthOutputs(seedOrSkB64: string, address?: string): Promise<ClaimableTransfer[]> {
  const result = await makeRpcCall('octra_stealthOutputs', [0]);
  if (!result || typeof result !== 'object') return [];

  const outputs = (result as Record<string, unknown[]>).outputs ?? [];
  if (!Array.isArray(outputs) || outputs.length === 0) return [];

  // Delegate heavy per-output ECDH + AES-GCM loops to the PVAC worker when
  // we're on the main thread. The worker's `pvacScanOutputs` op returns
  // matches in the same shape we need after a small field rename.
  const runningInWorker = typeof window === 'undefined';
  if (!runningInWorker) {
    try {
      const [{ runInWorker, isWorkerAvailable }] = await Promise.all([
        import('@/lib/pvac/pvac-worker-client'),
      ]);
      if (isWorkerAvailable()) {
        const workerResult = await runInWorker<{
          scanResult: {
            outputs: Array<{
              id: string;
              amountRaw: string;
              epochId: number;
              senderAddress: string;
              txHash: string;
              claimSecret: string;
              blinding: string;
              rawOutput: unknown;
            }>;
          };
        }>('pvacScanOutputs', {
          privateKey: seedOrSkB64,
          outputs,
        });

        if (workerResult.success && workerResult.data) {
          const claimable: ClaimableTransfer[] = workerResult.data.scanResult.outputs.map((m) => {
            const amountRaw = BigInt(m.amountRaw);
            return {
              id: m.id,
              amount: Number(amountRaw) / 1_000_000,
              amountRaw,
              epoch: m.epochId,
              sender: m.senderAddress,
              txHash: m.txHash,
              claimSecret: m.claimSecret,
              blinding: m.blinding,
              rawOutput: m.rawOutput,
            };
          });
          if (address) setCachedScanResults(address, claimable);
          return claimable;
        }
      }
    } catch {
      // Worker route failed — fall through to inline scan below.
    }
  }

  const edSk64 = resolveEd25519Sk64(seedOrSkB64);
  const { viewSk } = await deriveViewKeypair(edSk64);

  const claimable: ClaimableTransfer[] = [];

  for (const out of outputs as Record<string, unknown>[]) {
    if (out.claimed && out.claimed !== 0) continue;

    try {
      const ephB64 = out.eph_pub as string;
      if (!ephB64) continue;

      const ephRaw = decodeBase64(ephB64);
      if (ephRaw.length !== 32) continue;

      const shared = await ecdhSharedSecret(viewSk, ephRaw);
      const myTag = await computeStealthTag(shared);

      if (hexEncode(myTag) !== (out.stealth_tag ?? '')) continue;

      const dec = await decryptStealthAmount(shared, (out.enc_amount as string) ?? '');
      if (!dec) continue;

      const cs = await computeClaimSecret(shared);
      const id = out.id !== undefined ? String(out.id) : '';

      claimable.push({
        id,
        amount: Number(dec.amount) / 1_000_000,
        amountRaw: dec.amount,
        epoch: (out.epoch_id as number) ?? 0,
        sender: (out.sender_addr as string) ?? '',
        txHash: (out.tx_hash as string) ?? '',
        claimSecret: hexEncode(cs),
        blinding: encodeBase64(dec.blinding),
        rawOutput: out,
      });
    } catch {
      continue;
    }
  }

  if (address) setCachedScanResults(address, claimable)
  return claimable;
}
