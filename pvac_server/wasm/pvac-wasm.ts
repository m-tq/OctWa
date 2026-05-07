/**
 * pvac-wasm.ts
 *
 * TypeScript wrapper around the PVAC WebAssembly module.
 * Built with WASM_BIGINT=1 — native i64 support via JS BigInt.
 * All uint64_t parameters are passed directly as BigInt.
 *
 * Memory: 128MB initial, 2GB max, 32MB stack — sufficient for range proofs.
 */

interface EmscriptenModule {
  ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown
  getValue(ptr: number, type: string): number
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
}

type PvacModuleFactory = (opts?: object) => Promise<EmscriptenModule>
type PvacHandle = number

const HFHE_PREFIX = 'hfhe_v1|'
const ZKZP_PREFIX = 'zkzp_v2|'
const RP_PREFIX   = 'rp_v1|'

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export class PvacWasm {
  private mod: EmscriptenModule | null = null
  private pk: PvacHandle = 0
  private sk: PvacHandle = 0
  private prm: PvacHandle = 0

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async load(moduleFactory: PvacModuleFactory): Promise<void> {
    this.mod = await moduleFactory()
  }

  init(seed: Uint8Array): void {
    if (!this.mod) throw new Error('PvacWasm: call load() first')
    if (seed.length < 32) throw new Error('PvacWasm: seed must be at least 32 bytes')
    this.reset()
    const m = this.mod
    const seedPtr  = m._malloc(32)
    const pkOutPtr = m._malloc(4)
    const skOutPtr = m._malloc(4)
    m.HEAPU8.set(seed.subarray(0, 32), seedPtr)
    this.prm = m.ccall('pvac_default_params', 'number', [], []) as number
    m.ccall('pvac_keygen_from_seed', null,
      ['number', 'number', 'number', 'number'],
      [this.prm, seedPtr, pkOutPtr, skOutPtr])
    this.pk = m.getValue(pkOutPtr, 'i32')
    this.sk = m.getValue(skOutPtr, 'i32')
    m._free(seedPtr); m._free(pkOutPtr); m._free(skOutPtr)
    if (!this.pk || !this.sk) throw new Error('PvacWasm: keygen failed')
  }

  reset(): void {
    if (!this.mod) return
    if (this.pk)  { this.mod.ccall('pvac_free_pubkey', null, ['number'], [this.pk]);  this.pk  = 0 }
    if (this.sk)  { this.mod.ccall('pvac_free_seckey', null, ['number'], [this.sk]);  this.sk  = 0 }
    if (this.prm) { this.mod.ccall('pvac_free_params', null, ['number'], [this.prm]); this.prm = 0 }
  }

  get isInitialized(): boolean { return this.pk !== 0 && this.sk !== 0 }

  // ── Public key + AES KAT ───────────────────────────────────────────────────

  getPubkeyB64(): string {
    this.assertReady()
    const m = this.mod!
    const lenPtr  = m._malloc(4)
    const dataPtr = m.ccall('pvac_serialize_pubkey', 'number',
      ['number', 'number'], [this.pk, lenPtr]) as number
    const len = m.getValue(lenPtr, 'i32')
    m._free(lenPtr)
    const bytes = m.HEAPU8.slice(dataPtr, dataPtr + len)
    m.ccall('pvac_free_bytes', null, ['number'], [dataPtr])
    return base64Encode(bytes)
  }

  aesKat(): string {
    this.assertReady()
    const m = this.mod!
    const outPtr = m._malloc(16)
    m.ccall('pvac_aes_kat', null, ['number'], [outPtr])
    const bytes = m.HEAPU8.slice(outPtr, outPtr + 16)
    m._free(outPtr)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // ── Encrypt / Decrypt ──────────────────────────────────────────────────────

  encryptValue(value: bigint, seed?: Uint8Array): string {
    this.assertReady()
    const m = this.mod!
    const rngSeed = seed ?? this.randomBytes(32)
    const seedPtr = m._malloc(32)
    m.HEAPU8.set(rngSeed, seedPtr)
    // WASM_BIGINT=1: i64 passed as BigInt directly
    const ctPtr = m.ccall('pvac_enc_value_seeded', 'number',
      ['number', 'number', 'i64', 'number'],
      [this.pk, this.sk, value, seedPtr]) as number
    m._free(seedPtr)
    if (!ctPtr) throw new Error('PvacWasm: encrypt returned null')
    const encoded = this.encodeCipher(ctPtr)
    m.ccall('pvac_free_cipher', null, ['number'], [ctPtr])
    return encoded
  }

  decryptValue(cipherStr: string): bigint {
    this.assertReady()
    const m = this.mod!
    const ctPtr = this.decodeCipher(cipherStr)
    if (!ctPtr) throw new Error('PvacWasm: failed to decode cipher')

    const loPtr = m._malloc(8)
    const hiPtr = m._malloc(8)

    m.ccall('pvac_dec_value_fp', null,
      ['number', 'number', 'number', 'number', 'number'],
      [this.pk, this.sk, ctPtr, loPtr, hiPtr])

    let lo = 0n
    let hi = 0n
    for (let i = 0; i < 8; i++) {
      lo |= BigInt(m.HEAPU8[loPtr + i]) << BigInt(i * 8)
      hi |= BigInt(m.HEAPU8[hiPtr + i]) << BigInt(i * 8)
    }

    m._free(loPtr)
    m._free(hiPtr)
    m.ccall('pvac_free_cipher', null, ['number'], [ctPtr])

    if (hi === 0n) return lo

    const P = (1n << 127n) - 1n
    const val = (hi << 64n) | lo
    if (val > P / 2n) return -(P - val)
    return val
  }

  // ── Cipher arithmetic ──────────────────────────────────────────────────────

  ctSub(cipherA: string, cipherB: string): string {
    this.assertReady()
    const m = this.mod!
    const ctA = this.decodeCipher(cipherA)
    const ctB = this.decodeCipher(cipherB)
    if (!ctA) throw new Error('PvacWasm: ctSub — invalid cipher A')
    if (!ctB) { m.ccall('pvac_free_cipher', null, ['number'], [ctA]); throw new Error('PvacWasm: ctSub — invalid cipher B') }
    const ctNew = m.ccall('pvac_ct_sub', 'number',
      ['number', 'number', 'number'],
      [this.pk, ctA, ctB]) as number
    m.ccall('pvac_free_cipher', null, ['number'], [ctA])
    m.ccall('pvac_free_cipher', null, ['number'], [ctB])
    if (!ctNew) throw new Error('PvacWasm: ct_sub returned null')
    const encoded = this.encodeCipher(ctNew)
    m.ccall('pvac_free_cipher', null, ['number'], [ctNew])
    return encoded
  }

  // ── Proofs ─────────────────────────────────────────────────────────────────

  makeZeroProofBound(cipherStr: string, amount: bigint, blinding: Uint8Array): string {
    this.assertReady()
    const m = this.mod!
    const ctPtr = this.decodeCipher(cipherStr)
    if (!ctPtr) throw new Error('PvacWasm: makeZeroProofBound — invalid cipher')
    const blindPtr = m._malloc(32)
    m.HEAPU8.set(blinding.subarray(0, 32), blindPtr)
    // WASM_BIGINT=1: i64 as BigInt
    const zpPtr = m.ccall('pvac_make_zero_proof_bound', 'number',
      ['number', 'number', 'number', 'i64', 'number'],
      [this.pk, this.sk, ctPtr, amount, blindPtr]) as number
    m._free(blindPtr)
    m.ccall('pvac_free_cipher', null, ['number'], [ctPtr])
    if (!zpPtr) throw new Error('PvacWasm: zero proof returned null')
    const encoded = this.encodeZeroProof(zpPtr)
    m.ccall('pvac_free_zero_proof', null, ['number'], [zpPtr])
    return encoded
  }

  makeRangeProof(cipherStr: string, value: bigint): string {
    this.assertReady()
    const m = this.mod!
    const ctPtr = this.decodeCipher(cipherStr)
    if (!ctPtr) throw new Error('PvacWasm: makeRangeProof — invalid cipher')
    // WASM_BIGINT=1: i64 as BigInt
    const rpPtr = m.ccall('pvac_make_range_proof', 'number',
      ['number', 'number', 'number', 'i64'],
      [this.pk, this.sk, ctPtr, value]) as number
    m.ccall('pvac_free_cipher', null, ['number'], [ctPtr])
    if (!rpPtr) throw new Error('PvacWasm: range proof returned null')
    const encoded = this.encodeRangeProof(rpPtr)
    m.ccall('pvac_free_range_proof', null, ['number'], [rpPtr])
    return encoded
  }

  makeAggRangeProof(cipherStr: string, value: bigint): string {
    this.assertReady()
    const m = this.mod!
    const ctPtr = this.decodeCipher(cipherStr)
    if (!ctPtr) throw new Error('PvacWasm: makeAggRangeProof — invalid cipher')
    // WASM_BIGINT=1: i64 as BigInt
    const arpPtr = m.ccall('pvac_make_aggregated_range_proof', 'number',
      ['number', 'number', 'number', 'i64'],
      [this.pk, this.sk, ctPtr, value]) as number
    m.ccall('pvac_free_cipher', null, ['number'], [ctPtr])
    if (!arpPtr) throw new Error('PvacWasm: aggregated range proof returned null')
    const lenPtr  = m._malloc(4)
    const dataPtr = m.ccall('pvac_serialize_agg_range_proof', 'number',
      ['number', 'number'], [arpPtr, lenPtr]) as number
    const len = m.getValue(lenPtr, 'i32')
    m._free(lenPtr)
    const bytes = m.HEAPU8.slice(dataPtr, dataPtr + len)
    m.ccall('pvac_free_bytes', null, ['number'], [dataPtr])
    m.ccall('pvac_free_agg_range_proof', null, ['number'], [arpPtr])
    return RP_PREFIX + base64Encode(bytes)
  }

  // ── Pedersen Commitment ────────────────────────────────────────────────────

  pedersenCommit(amount: bigint, blinding: Uint8Array): string {
    this.assertReady()
    const m = this.mod!
    const blindPtr = m._malloc(32)
    const outPtr   = m._malloc(32)
    m.HEAPU8.set(blinding.subarray(0, 32), blindPtr)
    // WASM_BIGINT=1: i64 as BigInt
    m.ccall('pvac_pedersen_commit', null,
      ['i64', 'number', 'number'],
      [amount, blindPtr, outPtr])
    const bytes = m.HEAPU8.slice(outPtr, outPtr + 32)
    m._free(blindPtr); m._free(outPtr)
    return base64Encode(bytes)
  }

  // ── Cipher commitment ──────────────────────────────────────────────────────

  commitCipher(cipherStr: string): string {
    this.assertReady()
    const m = this.mod!
    const ctPtr = this.decodeCipher(cipherStr)
    if (!ctPtr) throw new Error('PvacWasm: commitCipher — invalid cipher')
    const outPtr = m._malloc(32)
    m.ccall('pvac_commit_ct', null, ['number', 'number', 'number'], [this.pk, ctPtr, outPtr])
    const bytes = m.HEAPU8.slice(outPtr, outPtr + 32)
    m._free(outPtr)
    m.ccall('pvac_free_cipher', null, ['number'], [ctPtr])
    return base64Encode(bytes)
  }

  // ── Random bytes ───────────────────────────────────────────────────────────

  randomBytesPublic(n: number): Uint8Array { return this.randomBytes(n) }

  // ── Private helpers ────────────────────────────────────────────────────────

  private assertReady(): void {
    if (!this.mod)            throw new Error('PvacWasm: call load() first')
    if (!this.pk || !this.sk) throw new Error('PvacWasm: call init() first')
  }

  private encodeCipher(ctPtr: PvacHandle): string {
    const m = this.mod!
    const lenPtr  = m._malloc(4)
    const dataPtr = m.ccall('pvac_serialize_cipher', 'number',
      ['number', 'number'], [ctPtr, lenPtr]) as number
    const len = m.getValue(lenPtr, 'i32')
    m._free(lenPtr)
    const bytes = m.HEAPU8.slice(dataPtr, dataPtr + len)
    m.ccall('pvac_free_bytes', null, ['number'], [dataPtr])
    return HFHE_PREFIX + base64Encode(bytes)
  }

  private decodeCipher(cipherStr: string): PvacHandle {
    if (!cipherStr.startsWith(HFHE_PREFIX)) return 0
    const m = this.mod!
    const raw    = base64Decode(cipherStr.slice(HFHE_PREFIX.length))
    const rawPtr = m._malloc(raw.length)
    m.HEAPU8.set(raw, rawPtr)
    const ctPtr = m.ccall('pvac_deserialize_cipher', 'number',
      ['number', 'number'], [rawPtr, raw.length]) as number
    m._free(rawPtr)
    return ctPtr
  }

  private encodeZeroProof(zpPtr: PvacHandle): string {
    const m = this.mod!
    const lenPtr  = m._malloc(4)
    const dataPtr = m.ccall('pvac_serialize_zero_proof', 'number',
      ['number', 'number'], [zpPtr, lenPtr]) as number
    const len = m.getValue(lenPtr, 'i32')
    m._free(lenPtr)
    const bytes = m.HEAPU8.slice(dataPtr, dataPtr + len)
    m.ccall('pvac_free_bytes', null, ['number'], [dataPtr])
    return ZKZP_PREFIX + base64Encode(bytes)
  }

  private encodeRangeProof(rpPtr: PvacHandle): string {
    const m = this.mod!
    const lenPtr  = m._malloc(4)
    const dataPtr = m.ccall('pvac_serialize_range_proof', 'number',
      ['number', 'number'], [rpPtr, lenPtr]) as number
    const len = m.getValue(lenPtr, 'i32')
    m._free(lenPtr)
    const bytes = m.HEAPU8.slice(dataPtr, dataPtr + len)
    m.ccall('pvac_free_bytes', null, ['number'], [dataPtr])
    return RP_PREFIX + base64Encode(bytes)
  }

  private randomBytes(n: number): Uint8Array {
    const buf = new Uint8Array(n)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(buf)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('crypto') as typeof import('crypto')
      nodeCrypto.randomFillSync(buf)
    }
    return buf
  }
}
