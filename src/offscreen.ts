/**
 * Offscreen PVAC runner.
 *
 * Hosted by `offscreen.html`. Opened and closed by `background.js` whenever
 * the SDK asks for a silent PVAC op (identity, ECDH, decrypt_cipher,
 * encrypt_value, scan_outputs).
 *
 * Shares the same `pvac-worker-client` that the popup uses, so the
 * underlying PVAC WASM Web Worker code is identical. The UI layer is
 * simply missing — the user never sees a popup.
 *
 * Transport: chrome.runtime.sendMessage — NOT chrome.storage.onChanged.
 * Storage events are not reliable in offscreen documents across Chrome
 * builds, so every request is pushed directly from background.js and
 * every reply travels back the same way.
 *
 * Wallet decryption: the service worker reads the session snapshot
 * (sessionKey + sessionEncKey + sessionWallets) from chrome.storage.session
 * — which is only exposed to trusted contexts in some Chrome builds — and
 * forwards it inside the PVAC request. The offscreen decrypts locally with
 * the same routines the popup uses, so no plaintext private key ever
 * crosses the sendMessage boundary.
 */

import { Buffer } from 'buffer'

import { runInWorker } from './lib/pvac/pvac-worker-client'
import { decryptSessionData } from './utils/password'
import type { Wallet } from './types/wallet'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
  const msg = '[offscreen] chrome.runtime.onMessage not available — offscreen cannot run'
  console.error(msg)
  throw new Error(msg)
}

type PvacOp = 'identity' | 'ecdh' | 'decrypt' | 'encrypt' | 'scan'

interface SessionSnapshot {
  sessionKey?: string
  sessionEncKey?: string
  sessionWallets?: string
}

interface PvacRequestBase {
  type: 'OFFSCREEN_PVAC_REQUEST'
  op: PvacOp
  pendingKey: string
  walletAddress: string
  sessionSnapshot: SessionSnapshot | null
}

interface IdentityRequest extends PvacRequestBase { op: 'identity' }
interface EcdhRequest     extends PvacRequestBase { op: 'ecdh'; theirViewPubkey: string }
interface DecryptRequest  extends PvacRequestBase { op: 'decrypt'; cipher: string }
interface EncryptRequest  extends PvacRequestBase { op: 'encrypt'; valueRaw: string | number }
interface ScanRequest     extends PvacRequestBase { op: 'scan'; outputs: unknown[] }

type PvacRequest =
  | IdentityRequest
  | EcdhRequest
  | DecryptRequest
  | EncryptRequest
  | ScanRequest

const RESULT_TYPE: Record<PvacOp, string> = {
  identity: 'PVAC_IDENTITY_RESULT',
  ecdh:     'PVAC_ECDH_RESULT',
  decrypt:  'PVAC_DECRYPT_RESULT',
  encrypt:  'PVAC_ENCRYPT_RESULT',
  scan:     'PVAC_SCAN_RESULT',
}

async function loadWalletFromSnapshot(
  walletAddress: string,
  snapshot: SessionSnapshot | null,
): Promise<Wallet | null> {
  if (!snapshot?.sessionEncKey || !snapshot?.sessionWallets) return null
  try {
    const json = await decryptSessionData(snapshot.sessionWallets, snapshot.sessionEncKey)
    const wallets = JSON.parse(json) as Wallet[]
    return wallets.find((w) => w.address === walletAddress) ?? wallets[0] ?? null
  } catch (err) {
    console.error('[offscreen] loadWalletFromSnapshot failed', err)
    return null
  }
}

function sendReply(op: PvacOp, pendingKey: string, payload: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({ type: RESULT_TYPE[op], pendingKey, ...payload })
  } catch (err) {
    console.error('[offscreen] sendMessage failed', err)
  }
}

async function runPvac(req: PvacRequest): Promise<void> {
  const wallet = await loadWalletFromSnapshot(req.walletAddress, req.sessionSnapshot)
  if (!wallet?.privateKey) {
    return sendReply(req.op, req.pendingKey, { success: false, error: 'Wallet locked' })
  }

  try {
    switch (req.op) {
      case 'identity': {
        const result = await runInWorker<{ identity: unknown }>('pvacGetIdentity', {
          privateKey: wallet.privateKey,
          walletAddress: wallet.address,
        })
        if (result.success && result.data) {
          return sendReply('identity', req.pendingKey, { success: true, identity: result.data.identity })
        }
        return sendReply('identity', req.pendingKey, { success: false, error: result.error })
      }
      case 'ecdh': {
        const result = await runInWorker<{ sharedSecretResult: unknown }>('pvacComputeSharedSecret', {
          privateKey: wallet.privateKey,
          theirViewPubkey: req.theirViewPubkey,
        })
        if (result.success && result.data) {
          return sendReply('ecdh', req.pendingKey, {
            success: true,
            sharedSecretResult: result.data.sharedSecretResult,
          })
        }
        return sendReply('ecdh', req.pendingKey, { success: false, error: result.error })
      }
      case 'decrypt': {
        const result = await runInWorker<{ valueRaw: string; valueOct: number }>('pvacDecryptCipher', {
          privateKey: wallet.privateKey,
          cipher: req.cipher,
        })
        if (result.success && result.data) {
          return sendReply('decrypt', req.pendingKey, {
            success: true,
            valueRaw: result.data.valueRaw,
            valueOct: result.data.valueOct,
          })
        }
        return sendReply('decrypt', req.pendingKey, { success: false, error: result.error })
      }
      case 'encrypt': {
        if (!wallet.publicKey) {
          return sendReply('encrypt', req.pendingKey, { success: false, error: 'Wallet locked' })
        }
        const result = await runInWorker<{ cipher: string }>('pvacEncryptValue', {
          privateKey: wallet.privateKey,
          publicKey: wallet.publicKey,
          address: wallet.address,
          valueRaw: String(req.valueRaw),
        })
        if (result.success && result.data) {
          return sendReply('encrypt', req.pendingKey, { success: true, cipher: result.data.cipher })
        }
        return sendReply('encrypt', req.pendingKey, { success: false, error: result.error })
      }
      case 'scan': {
        const result = await runInWorker<{ scanResult: unknown }>('pvacScanOutputs', {
          privateKey: wallet.privateKey,
          address: wallet.address,
          outputs: req.outputs,
        })
        if (result.success && result.data) {
          return sendReply('scan', req.pendingKey, {
            success: true,
            scanResult: result.data.scanResult,
          })
        }
        return sendReply('scan', req.pendingKey, { success: false, error: result.error })
      }
    }
  } catch (err) {
    console.error('[offscreen] PVAC op failed', req.op, err)
    sendReply(req.op, req.pendingKey, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, _sendResponse) => {
  const req = msg as PvacRequest
  if (req?.type !== 'OFFSCREEN_PVAC_REQUEST' || !req.op || !req.pendingKey || !req.walletAddress) {
    // Not ours — let other listeners handle it. Returning false signals this
    // listener is done; we never call sendResponse.
    return false
  }
  // Fire-and-forget. The real result is delivered via a separate
  // chrome.runtime.sendMessage({ type: 'PVAC_*_RESULT', pendingKey, ... }).
  void runPvac(req)
  return false
})

try {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' })
} catch {
  /* background may not be listening yet */
}
