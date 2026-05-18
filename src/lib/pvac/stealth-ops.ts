/**
 * Browser-based PVAC stealth operations — fully self-contained.
 *
 *   1. stealthSend  — WASM (range proofs computed locally)
 *   2. stealthScan  — pure TypeScript (Web Crypto, no WASM)
 *   3. claimStealth — WASM (no range proof needed)
 *
 * Strategy:
 *   - Everything runs in the browser worker. No native sidecar.
 *   - Stealth send needs two range proofs (~9 min total on browser MT
 *     for a 12-core machine). Pass `input.rangeProofTickets` to halve
 *     the user-visible latency by precomputing them in the background.
 */

import { getPvacWasm } from './wasm-loader'
import { ensurePvacRegisteredOnNode } from './node-registration'
import {
  resolveSecretKey64,
  hexPubkeyToBase64,
  decodeBase64,
  encodeBase64,
  encodeHex,
  deriveViewKeypair,
  ecdhSharedSecret,
  computeStealthTag,
  computeClaimSecret,
  computeClaimPub,
  decryptStealthAmount,
  encryptStealthAmount,
  buildAndSignTx,
} from './crypto-utils'
import nacl from 'tweetnacl'
import type {
  StealthSendInput,
  ScanStealthInput,
  ClaimStealthInput,
  TxPayloadResult,
  ScanResult,
  ScannedTransfer,
  PvacResult,
  PvacProgressCallback,
} from './types'

const DEFAULT_STEALTH_OU = '5000'
const STEALTH_PROTOCOL_VERSION = 5

/** Yield to the event loop so progress messages and React renders can flush. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// ─── 1. Stealth send — WASM only ─────────────────────────────────────────────

/**
 * Build a signed v5 stealth transaction.
 *
 * Pipeline (all in WASM, no native sidecar required):
 *   1. Derive PVAC keypair, ensure registered on node
 *   2. Compute current encrypted balance via local WASM decrypt
 *   3. Generate ephemeral X25519 keypair, ECDH against recipient view pubkey
 *   4. Stealth tag, claim secret, claim pubkey from shared secret + recipient
 *   5. AES-GCM encrypt (amount, blinding) under shared secret
 *   6. PVAC encrypt amount → ct_delta;  pedersen commit; bound zero proof
 *   7. ct_new = ct_current ⊖ ct_delta
 *   8. Build TWO range proofs:
 *        rp_delta   on ct_delta at value=amount
 *        rp_balance on ct_new   at value=balance-amount
 *      Each ~4-5 min on browser MT. With `rangeProofTickets`, both run
 *      in finalize-only mode (~halves latency).
 *   9. Sign tx
 */
export async function stealthSend(
  input: StealthSendInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<TxPayloadResult>> {
  try {
    onProgress?.({ step: 'initializing', label: 'Loading crypto engine...', percent: 5 })

    const ou = input.ou ?? DEFAULT_STEALTH_OU
    const sk64 = resolveSecretKey64(input.privateKey)
    const publicKeyB64 = hexPubkeyToBase64(input.publicKey)

    onProgress?.({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 10 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'registering_pubkey', label: 'Registering PVAC key on node...', percent: 15 })
    await ensurePvacRegisteredOnNode(pvac, input.address, sk64, publicKeyB64)

    onProgress?.({ step: 'decrypting', label: 'Reading encrypted balance...', percent: 18 })
    await tick()
    const currentBalance = pvac.decryptValue(input.currentCipher)
    if (input.amountRaw > currentBalance) {
      return { success: false, error: 'Insufficient encrypted balance' }
    }
    const newBalance = currentBalance - input.amountRaw

    // ── Stealth crypto (Web Crypto, fast) ─────────────────────────────────
    onProgress?.({ step: 'ecdh', label: 'Building stealth address...', percent: 22 })
    const ephSk = crypto.getRandomValues(new Uint8Array(32))
    const ephPk = nacl.scalarMult.base(ephSk)
    const recipientViewPub = decodeBase64(input.recipientViewPubkey)
    if (recipientViewPub.length !== 32) {
      return { success: false, error: 'Invalid recipient view pubkey' }
    }
    const shared = await ecdhSharedSecret(ephSk, recipientViewPub)
    const stealthTagBytes = await computeStealthTag(shared)
    const claimSecret = await computeClaimSecret(shared)
    const claimPubBytes = await computeClaimPub(claimSecret, input.toAddress)

    const blinding = pvac.randomBytesPublic(32)
    const encAmount = await encryptStealthAmount(shared, input.amountRaw, blinding)

    // ── PVAC heavy work ──────────────────────────────────────────────────
    onProgress?.({ step: 'encrypting', label: 'Encrypting delta cipher...', percent: 28 })
    await tick()
    const seed = pvac.randomBytesPublic(32)
    const ctDelta = pvac.encryptValue(input.amountRaw, seed)
    const commitmentBytes = pvac.commitCipher(ctDelta)
    const amountCommitment = pvac.pedersenCommit(input.amountRaw, blinding)

    onProgress?.({ step: 'building_proof', label: 'Building bound zero proof...', percent: 32 })
    await tick()
    const sendZeroProof = pvac.makeZeroProofBound(ctDelta, input.amountRaw, blinding)

    onProgress?.({ step: 'building_proof', label: 'Computing new balance cipher...', percent: 36 })
    await tick()
    const ctNewBalance = pvac.ctSub(input.currentCipher, ctDelta)

    // ── Two range proofs ─────────────────────────────────────────────────
    // No way to parallelise these inside one WASM thread pool — they
    // would compete for the same workers. Run sequentially. With tickets
    // each call runs only the finalise tail (~4 min instead of ~9 min).
    onProgress?.({
      step: 'building_proof',
      label: 'Generating delta range proof (1/2 — this may take 4–9 min)...',
      percent: 40,
    })
    await tick()
    const rangeProofDelta = input.rangeProofTickets
      ? pvac.finalizeRangeProofTicket(ctDelta, input.rangeProofTickets.delta)
      : pvac.makeRangeProof(ctDelta, input.amountRaw)

    onProgress?.({
      step: 'building_proof',
      label: 'Generating balance range proof (2/2 — this may take 4–9 min)...',
      percent: 70,
    })
    await tick()
    const rangeProofBalance = input.rangeProofTickets
      ? pvac.finalizeRangeProofTicket(ctNewBalance, input.rangeProofTickets.balance)
      : pvac.makeRangeProof(ctNewBalance, newBalance)

    onProgress?.({ step: 'building_tx', label: 'Signing transaction...', percent: 95 })

    const stealthData = {
      version:             STEALTH_PROTOCOL_VERSION,
      delta_cipher:        ctDelta,
      commitment:          commitmentBytes,
      range_proof_delta:   rangeProofDelta,
      range_proof_balance: rangeProofBalance,
      eph_pub:             encodeBase64(ephPk),
      stealth_tag:         encodeHex(stealthTagBytes),
      enc_amount:          encAmount,
      claim_pub:           encodeHex(claimPubBytes),
      amount_commitment:   amountCommitment,
      send_zero_proof:     sendZeroProof,
    }

    const tx = buildAndSignTx({
      from:           input.address,
      to_:            'stealth',
      amount:         '0',
      nonce:          input.nonce,
      ou,
      timestamp:      Date.now() / 1000,
      op_type:        'stealth',
      encrypted_data: JSON.stringify(stealthData),
      sk64,
      publicKeyB64,
    })

    onProgress?.({ step: 'done', label: 'Done', percent: 100 })
    return { success: true, data: { tx } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Stealth send failed',
    }
  }
}

// ─── 2. Stealth scan (pure TS — no WASM, no server) ──────────────────────────

/**
 * Scan a list of stealth outputs to find transfers addressed to this wallet.
 * 100% pure TypeScript using Web Crypto API — no WASM or server required.
 */
export async function stealthScan(
  input: ScanStealthInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<ScanResult>> {
  try {
    onProgress?.({ step: 'initializing', label: 'Deriving view key...', percent: 5 })

    const sk64 = resolveSecretKey64(input.privateKey)
    const { viewSk } = await deriveViewKeypair(sk64)

    const transfers: ScannedTransfer[] = []
    const total = input.outputs.length

    onProgress?.({ step: 'scanning', label: `Scanning ${total} outputs...`, percent: 10 })

    for (let i = 0; i < total; i++) {
      const output = input.outputs[i]
      if (output.claimed && output.claimed !== 0) continue

      try {
        const ephPubBytes = decodeBase64(output.eph_pub)
        if (ephPubBytes.length !== 32) continue

        const shared = await ecdhSharedSecret(viewSk, ephPubBytes)
        const myTag = encodeHex(await computeStealthTag(shared))
        if (myTag !== output.stealth_tag) continue

        const decrypted = await decryptStealthAmount(shared, output.enc_amount)
        if (!decrypted) continue

        const claimSecret = await computeClaimSecret(shared)
        const id = typeof output.id === 'string' ? output.id : String(output.id)

        transfers.push({
          id,
          amountRaw:     decrypted.amountRaw,
          epochId:       output.epoch_id ?? 0,
          senderAddress: output.sender_addr ?? '',
          txHash:        output.tx_hash ?? '',
          claimSecret:   encodeHex(claimSecret),
          blinding:      encodeBase64(decrypted.blinding),
          fullOutput:    output,
        })
      } catch {
        continue
      }

      const percent = 10 + Math.floor(((i + 1) / total) * 85)
      onProgress?.({ step: 'scanning', label: `Scanning ${i + 1}/${total}...`, percent })
    }

    onProgress?.({ step: 'done', label: 'Done', percent: 100 })
    return { success: true, data: { transfers } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Stealth scan failed',
    }
  }
}

// ─── 3. Claim stealth — WASM (no server needed) ───────────────────────────────

/**
 * Build a signed "claim" transaction that adds a received stealth transfer
 * to the wallet's FHE-encrypted private balance.
 * Uses WASM for FHE encrypt + zero proof — no range proof needed for claim.
 */
export async function claimStealth(
  input: ClaimStealthInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<TxPayloadResult>> {
  try {
    onProgress?.({ step: 'initializing', label: 'Loading crypto engine...', percent: 5 })

    const sk64 = resolveSecretKey64(input.privateKey)
    const publicKeyB64 = hexPubkeyToBase64(input.publicKey)
    const ou = input.ou ?? DEFAULT_STEALTH_OU

    onProgress?.({ step: 'ecdh', label: 'Decrypting stealth amount...', percent: 15 })
    const { viewSk } = await deriveViewKeypair(sk64)
    const ephPubBytes = decodeBase64(input.stealthOutput.eph_pub)

    if (ephPubBytes.length !== 32) {
      return { success: false, error: 'Invalid ephemeral pubkey in stealth output' }
    }

    const shared = await ecdhSharedSecret(viewSk, ephPubBytes)
    const decrypted = await decryptStealthAmount(shared, input.stealthOutput.enc_amount)
    if (!decrypted) {
      return { success: false, error: 'Failed to decrypt stealth amount' }
    }

    const claimSecret = await computeClaimSecret(shared)

    onProgress?.({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 25 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'encrypting', label: 'Encrypting claimed amount...', percent: 40 })
    const claimCipher = pvac.encryptValue(decrypted.amountRaw)
    const commitment  = pvac.commitCipher(claimCipher)

    onProgress?.({ step: 'building_proof', label: 'Building zero-knowledge proof...', percent: 60 })
    const zeroProof = pvac.makeZeroProofBound(claimCipher, decrypted.amountRaw, decrypted.blinding)

    onProgress?.({ step: 'building_tx', label: 'Signing transaction...', percent: 85 })

    const claimData = {
      version:      STEALTH_PROTOCOL_VERSION,
      output_id:    input.stealthOutput.id,
      claim_cipher: claimCipher,
      commitment,
      claim_secret: encodeHex(claimSecret),
      zero_proof:   zeroProof,
    }

    const tx = buildAndSignTx({
      from:           input.address,
      to_:            input.address,
      amount:         '0',
      nonce:          input.nonce,
      ou,
      timestamp:      Date.now() / 1000,
      op_type:        'claim',
      encrypted_data: JSON.stringify(claimData),
      sk64,
      publicKeyB64,
    })

    onProgress?.({ step: 'done', label: 'Done', percent: 100 })
    return { success: true, data: { tx } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Claim stealth failed',
    }
  }
}
