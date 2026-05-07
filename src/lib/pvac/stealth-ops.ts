/**
 * Browser-based PVAC stealth operations — hybrid mode.
 *
 *   1. stealthSend  — pvac-local-server (range proofs native)
 *   2. stealthScan  — pure TypeScript (Web Crypto, no WASM)
 *   3. claimStealth — WASM + Web Crypto (no server needed)
 *
 * Hybrid strategy:
 *   - stealthSend: server handles both range proofs (~4 min each native)
 *   - stealthScan: 100% pure TS, fastest, no WASM
 *   - claimStealth: WASM for FHE encrypt + zero proof (no range proof needed)
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
  decryptStealthAmount,
  buildAndSignTx,
} from './crypto-utils'
import {
  serverStealthSend,
  RangeServerError,
} from '@/services/rangeProofServer'
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

// ─── 1. Stealth send — hybrid (server for range proofs) ──────────────────────

/**
 * Build a signed "stealth" transaction.
 *
 * Hybrid strategy:
 *   - WASM (Web Worker): keygen, registration
 *   - pvac-local-server: ECDH, encrypt delta, range proofs, sign tx
 *
 * Falls back with isRangeServerRequired=true if server is not running.
 */
export async function stealthSend(
  input: StealthSendInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<TxPayloadResult> & { isRangeServerRequired?: boolean }> {
  try {
    onProgress?.({ step: 'initializing', label: 'Connecting to local server...', percent: 10 })

    const ou = input.ou ?? DEFAULT_STEALTH_OU
    const sk64 = resolveSecretKey64(input.privateKey)
    const publicKeyB64 = hexPubkeyToBase64(input.publicKey)

    onProgress?.({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 15 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'registering_pubkey', label: 'Registering PVAC key on node...', percent: 20 })
    await ensurePvacRegisteredOnNode(pvac, input.address, sk64, publicKeyB64)

    onProgress?.({ step: 'encrypting', label: 'Building stealth tx on local server...', percent: 40 })

    try {
      const { getActiveRPCProvider } = await import('@/utils/rpc')
      const rpcUrl = getActiveRPCProvider()?.url ?? ''

      const result = await serverStealthSend({
        privateKey:          input.privateKey,
        publicKey:           input.publicKey,
        fromAddress:         input.address,
        toAddress:           input.toAddress,
        amountRaw:           input.amountRaw,
        currentCipher:       input.currentCipher,
        recipientViewPubkey: input.recipientViewPubkey,
        nonce:               input.nonce,
        ou,
        timestamp:           Date.now() / 1000,
        rpcUrl,
      })

      onProgress?.({ step: 'done', label: 'Done', percent: 100 })
      return { success: true, data: { tx: result.tx as ReturnType<typeof buildAndSignTx> } }
    } catch (err) {
      if (err instanceof RangeServerError && err.isUnavailable) {
        return {
          success: false,
          error: 'pvac-local-server is required for stealth send. Please start it first.',
          isRangeServerRequired: true,
        }
      }
      throw err
    }
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
