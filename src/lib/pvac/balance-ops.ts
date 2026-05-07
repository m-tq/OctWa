/**
 * Browser-based PVAC balance operations — hybrid mode.
 *
 *   1. decryptBalance   — read encrypted balance (WASM, no server)
 *   2. encryptBalance   — public -> private (WASM, no server)
 *   3. decryptToPublic  — private -> public (pvac-local-server for range proof)
 *
 * Hybrid strategy:
 *   - Light ops (keygen, encrypt, zero proof): WASM in Web Worker
 *   - Heavy ops (aggregated range proof): pvac-local-server native binary
 *
 * pvac-local-server handles the ~4 min range proof natively (AES-NI).
 * WASM handles everything else so no server is needed for most operations.
 */

import { getPvacWasm } from './wasm-loader'
import { ensurePvacRegisteredOnNode } from './node-registration'
import {
  resolveSecretKey64,
  hexPubkeyToBase64,
  buildAndSignTx,
} from './crypto-utils'
import {
  serverDecryptToPublic,
  RangeServerError,
} from '@/services/rangeProofServer'
import type {
  DecryptReadInput,
  DecryptReadResult,
  EncryptBalanceInput,
  DecryptBalanceInput,
  TxPayloadResult,
  PvacResult,
  PvacProgressCallback,
} from './types'

const DEFAULT_ENCRYPT_OU = '3000'
const DEFAULT_DECRYPT_OU = '3000'

/** Yield to the event loop so progress messages and React renders can flush. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// ─── 1. Decrypt balance (read-only, no tx) ────────────────────────────────────

/**
 * Decrypt an FHE-encrypted balance cipher to a raw bigint value.
 * Read-only — no transaction is built. Runs in a Web Worker via WASM.
 */
export async function decryptBalance(
  input: DecryptReadInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<DecryptReadResult>> {
  try {
    onProgress?.({ step: 'initializing', label: 'Loading crypto engine...', percent: 5 })

    if (!input.cipher || input.cipher === '0') {
      return { success: true, data: { balanceRaw: 0n } }
    }

    onProgress?.({ step: 'keygen', label: 'Deriving keys...', percent: 20 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'decrypting', label: 'Decrypting balance...', percent: 60 })
    await tick()
    const balanceRaw = pvac.decryptValue(input.cipher)

    onProgress?.({ step: 'done', label: 'Done', percent: 100 })
    return { success: true, data: { balanceRaw } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
    }
  }
}

// ─── 2. Encrypt balance (public -> private) ───────────────────────────────────

/**
 * Build a signed "encrypt" transaction that moves public OCT into the
 * FHE-encrypted private balance. Runs in a Web Worker via WASM.
 */
export async function encryptBalance(
  input: EncryptBalanceInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<TxPayloadResult>> {
  try {
    onProgress?.({ step: 'initializing', label: 'Loading crypto engine...', percent: 5 })

    const sk64 = resolveSecretKey64(input.privateKey)
    const publicKeyB64 = hexPubkeyToBase64(input.publicKey)
    const ou = input.ou ?? DEFAULT_ENCRYPT_OU

    onProgress?.({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 10 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'registering_pubkey', label: 'Registering PVAC key on node...', percent: 20 })
    await ensurePvacRegisteredOnNode(pvac, input.address, sk64, publicKeyB64)

    onProgress?.({ step: 'encrypting', label: 'FHE-encrypting value...', percent: 35 })
    await tick()
    const seed = pvac.randomBytesPublic(32)
    const blinding = pvac.randomBytesPublic(32)

    await tick()
    const cipher = pvac.encryptValue(input.amountRaw, seed)

    onProgress?.({ step: 'building_proof', label: 'Building Pedersen commitment...', percent: 55 })
    await tick()
    const amountCommitment = pvac.pedersenCommit(input.amountRaw, blinding)

    onProgress?.({ step: 'building_proof', label: 'Building zero-knowledge proof...', percent: 70 })
    await tick()
    const zeroProof = pvac.makeZeroProofBound(cipher, input.amountRaw, blinding)

    onProgress?.({ step: 'building_tx', label: 'Signing transaction...', percent: 88 })

    const payload = {
      cipher,
      amount_commitment: amountCommitment,
      zero_proof:        zeroProof,
      blinding:          btoa(String.fromCharCode(...blinding)),
    }

    const tx = buildAndSignTx({
      from:           input.address,
      to_:            input.address,
      amount:         input.amountRaw.toString(),
      nonce:          input.nonce,
      ou,
      timestamp:      Date.now() / 1000,
      op_type:        'encrypt',
      encrypted_data: JSON.stringify(payload),
      sk64,
      publicKeyB64,
    })

    onProgress?.({ step: 'done', label: 'Done', percent: 100 })
    return { success: true, data: { tx } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Encrypt failed',
    }
  }
}

// ─── 3. Decrypt to public (private -> public) — hybrid ───────────────────────

/**
 * Build a signed "decrypt" transaction.
 *
 * Hybrid strategy:
 *   - WASM (Web Worker): keygen, registration, balance decrypt
 *   - pvac-local-server: encrypt amount, zero proof, range proof, sign tx
 *
 * The server handles the ~4 min aggregated range proof natively (AES-NI).
 * Falls back with isRangeServerRequired=true if server is not running.
 */
export async function decryptToPublic(
  input: DecryptBalanceInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<TxPayloadResult> & { isRangeServerRequired?: boolean }> {
  try {
    onProgress?.({ step: 'initializing', label: 'Connecting to local server...', percent: 10 })

    const ou = input.ou ?? DEFAULT_DECRYPT_OU
    const sk64 = resolveSecretKey64(input.privateKey)
    const publicKeyB64 = hexPubkeyToBase64(input.publicKey)

    onProgress?.({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 15 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'registering_pubkey', label: 'Registering PVAC key on node...', percent: 20 })
    await ensurePvacRegisteredOnNode(pvac, input.address, sk64, publicKeyB64)

    // Decrypt current balance in WASM — pass as hint to server so it doesn't
    // need to re-decrypt (avoids pvac_dec_value_fp vs pvac_dec_value mismatch).
    // Server will fetch fresh cipher from node and invalidate hint if changed.
    onProgress?.({ step: 'decrypting', label: 'Reading current balance...', percent: 30 })
    await tick()
    const currentBalance = pvac.decryptValue(input.currentCipher)

    if (input.amountRaw > currentBalance) {
      return { success: false, error: 'Insufficient encrypted balance' }
    }

    onProgress?.({ step: 'encrypting', label: 'Building decrypt tx on local server...', percent: 40 })

    try {
      const { getActiveRPCProvider } = await import('@/utils/rpc')
      const rpcUrl = getActiveRPCProvider()?.url ?? ''

      const result = await serverDecryptToPublic({
        privateKey:     input.privateKey,
        publicKey:      input.publicKey,
        address:        input.address,
        amountRaw:      input.amountRaw,
        currentCipher:  input.currentCipher,
        currentBalance,
        nonce:          input.nonce,
        ou,
        timestamp:      Date.now() / 1000,
        rpcUrl,
      })

      onProgress?.({ step: 'done', label: 'Done', percent: 100 })
      return { success: true, data: { tx: result.tx as ReturnType<typeof buildAndSignTx> } }
    } catch (err) {
      if (err instanceof RangeServerError && err.isUnavailable) {
        return {
          success: false,
          error: 'pvac-local-server is required for decrypt operations. Please start it first.',
          isRangeServerRequired: true,
        }
      }
      throw err
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decrypt failed',
    }
  }
}
