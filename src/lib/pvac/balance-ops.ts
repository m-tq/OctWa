/**
 * Browser-based PVAC balance operations — fully self-contained.
 *
 *   1. decryptBalance   — read encrypted balance (WASM, no server)
 *   2. encryptBalance   — public -> private (WASM, no server)
 *   3. decryptToPublic  — private -> public (WASM, no server)
 *
 * Strategy:
 *   - All operations run in WASM inside a Web Worker.
 *   - The aggregated range proof for `decryptToPublic` is computed locally;
 *     it's heavy (5-10 minutes browser MT) but doesn't need a sidecar.
 *   - Optional precompute tickets cut foreground latency in half — pass
 *     `aggTicket` to `decryptToPublic` after pre-warming via PvacWasm's
 *     `makeAggRangeProofTicket` while the user is browsing.
 */

import { getPvacWasm } from './wasm-loader'
import { ensurePvacRegisteredOnNode } from './node-registration'
import {
  resolveSecretKey64,
  hexPubkeyToBase64,
  buildAndSignTx,
} from './crypto-utils'
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

// ─── 3. Decrypt to public (private -> public) — WASM only ───────────────────

/**
 * Build a signed "decrypt" transaction.
 *
 * Pipeline (all in WASM, no native sidecar required):
 *   1. Derive PVAC keypair from privateKey
 *   2. Make sure the PVAC pubkey is registered on the node
 *   3. Decrypt currentCipher locally to get the plaintext balance
 *   4. Encrypt amount → ct_amount
 *   5. ct_new = ct_current ⊖ ct_amount   (homomorphic subtract)
 *   6. Build amount commitment + bound zero proof
 *   7. Build aggregated range proof on ct_new at value (balance - amount)
 *   8. Sign tx
 *
 * Step 7 dominates wall time (5-10 min on browser MT). Pass an optional
 * pre-computed ticket via `input.aggTicket` to skip the value-dependent
 * heavy phase (~5 min savings).
 */
export async function decryptToPublic(
  input: DecryptBalanceInput,
  onProgress?: PvacProgressCallback,
): Promise<PvacResult<TxPayloadResult>> {
  try {
    onProgress?.({ step: 'initializing', label: 'Loading crypto engine...', percent: 5 })

    const ou = input.ou ?? DEFAULT_DECRYPT_OU
    const sk64 = resolveSecretKey64(input.privateKey)
    const publicKeyB64 = hexPubkeyToBase64(input.publicKey)

    onProgress?.({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 10 })
    const pvac = await getPvacWasm(input.privateKey)

    onProgress?.({ step: 'registering_pubkey', label: 'Registering PVAC key on node...', percent: 15 })
    await ensurePvacRegisteredOnNode(pvac, input.address, sk64, publicKeyB64)

    onProgress?.({ step: 'decrypting', label: 'Reading current balance...', percent: 20 })
    await tick()
    const currentBalance = pvac.decryptValue(input.currentCipher)

    if (input.amountRaw > currentBalance) {
      return { success: false, error: 'Insufficient encrypted balance' }
    }

    const newBalance = currentBalance - input.amountRaw

    onProgress?.({ step: 'encrypting', label: 'Encrypting amount...', percent: 25 })
    await tick()
    const seed = pvac.randomBytesPublic(32)
    const blinding = pvac.randomBytesPublic(32)
    const ctAmount = pvac.encryptValue(input.amountRaw, seed)

    onProgress?.({ step: 'building_proof', label: 'Building amount commitment...', percent: 30 })
    await tick()
    const amountCommitment = pvac.pedersenCommit(input.amountRaw, blinding)

    onProgress?.({ step: 'building_proof', label: 'Building zero-knowledge proof...', percent: 35 })
    await tick()
    const zeroProof = pvac.makeZeroProofBound(ctAmount, input.amountRaw, blinding)

    onProgress?.({ step: 'building_proof', label: 'Computing new balance cipher...', percent: 40 })
    await tick()
    const ctNewBalance = pvac.ctSub(input.currentCipher, ctAmount)

    onProgress?.({
      step: 'building_proof',
      label: 'Generating range proof (this may take 5–10 min)...',
      percent: 45,
    })
    await tick()
    const rangeProofBalance = input.aggTicket
      ? pvac.finalizeAggRangeProofTicket(ctNewBalance, input.aggTicket)
      : pvac.makeAggRangeProof(ctNewBalance, newBalance)

    onProgress?.({ step: 'building_tx', label: 'Signing transaction...', percent: 92 })

    const payload = {
      cipher:              ctAmount,
      amount_commitment:   amountCommitment,
      zero_proof:          zeroProof,
      blinding:            btoa(String.fromCharCode(...blinding)),
      range_proof_balance: rangeProofBalance,
    }

    const tx = buildAndSignTx({
      from:           input.address,
      to_:            input.address,
      amount:         input.amountRaw.toString(),
      nonce:          input.nonce,
      ou,
      timestamp:      Date.now() / 1000,
      op_type:        'decrypt',
      encrypted_data: JSON.stringify(payload),
      sk64,
      publicKeyB64,
    })

    onProgress?.({ step: 'done', label: 'Done', percent: 100 })
    return { success: true, data: { tx } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decrypt failed',
    }
  }
}
