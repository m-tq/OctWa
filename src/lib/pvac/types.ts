/**
 * Shared types for the browser-based PVAC crypto engine.
 *
 * All private operations (encrypt, decrypt, stealth send/scan/claim) use
 * these types regardless of whether they run via WASM or the native server.
 */

import type { Transaction } from '@/types/wallet'

// ─── Progress tracking ────────────────────────────────────────────────────────

export type PvacOperationStep =
  | 'initializing'
  | 'keygen'
  | 'encrypting'
  | 'decrypting'
  | 'building_proof'
  | 'building_range_proof'
  | 'building_tx'
  | 'registering_pubkey'
  | 'ecdh'
  | 'scanning'
  | 'done'

export interface PvacProgress {
  step: PvacOperationStep
  /** Human-readable label shown in the UI. */
  label: string
  /** 0–100 */
  percent: number
}

export type PvacProgressCallback = (progress: PvacProgress) => void

// ─── Operation inputs ─────────────────────────────────────────────────────────

export interface WalletCredentials {
  /** Base64-encoded 32-byte seed or 64-byte Ed25519 secret key. */
  privateKey: string
  /** Hex-encoded 32-byte Ed25519 public key. */
  publicKey: string
  address: string
}

export interface EncryptBalanceInput extends WalletCredentials {
  /** Amount in raw units (1 OCT = 1_000_000). */
  amountRaw: bigint
  nonce: number
  /** Operation units (gas). Defaults to 3000. */
  ou?: string
}

export interface DecryptBalanceInput extends WalletCredentials {
  amountRaw: bigint
  currentCipher: string
  nonce: number
  ou?: string
  /**
   * Optional aggregated range-proof ticket pre-computed for the new
   * balance value (currentBalance - amountRaw). Halves user-visible
   * latency when set; the heavy phase ran during background pre-compute.
   * Single-use — the ticket is consumed by this call.
   */
  aggTicket?: number
}

export interface DecryptReadInput {
  /** FHE cipher string with "hfhe_v1|" prefix. */
  cipher: string
  privateKey: string
}

export interface StealthSendInput extends WalletCredentials {
  toAddress: string
  amountRaw: bigint
  currentCipher: string
  /** Base64-encoded Curve25519 view public key of the recipient. */
  recipientViewPubkey: string
  nonce: number
  ou?: string
  /**
   * Optional pair of pre-computed range-proof tickets — `delta` for the
   * amount-cipher proof and `balance` for the new-balance-cipher proof.
   * Both single-use, both consumed by this call. Halves user latency.
   */
  rangeProofTickets?: { delta: number; balance: number }
}

export interface StealthOutput {
  id: string | number
  eph_pub: string
  stealth_tag: string
  enc_amount: string
  claimed?: number
  epoch_id?: number
  sender_addr?: string
  tx_hash?: string
  [key: string]: unknown
}

export interface ScanStealthInput {
  privateKey: string
  outputs: StealthOutput[]
}

export interface ClaimStealthInput extends WalletCredentials {
  stealthOutput: StealthOutput
  nonce: number
  ou?: string
}

// ─── Operation results ────────────────────────────────────────────────────────

export interface PvacResult<T> {
  success: boolean
  data?: T
  error?: string
}

export interface DecryptReadResult {
  balanceRaw: bigint
}

export interface TxPayloadResult {
  /** Signed transaction object ready to submit to the node. */
  tx: Transaction
}

export interface ScannedTransfer {
  id: string
  amountRaw: bigint
  epochId: number
  senderAddress: string
  txHash: string
  claimSecret: string
  blinding: string
  fullOutput: StealthOutput
}

export interface ScanResult {
  transfers: ScannedTransfer[]
}
