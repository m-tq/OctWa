/**
 * pvac-worker.ts — PVAC WASM Web Worker
 *
 * Runs all heavy PVAC crypto operations off the main thread so the UI
 * stays responsive during keygen, encrypt, proof generation, etc.
 *
 * Communication protocol:
 *   Main → Worker:  { id, op, payload }
 *   Worker → Main:  { id, type: 'progress', step, label, percent }
 *                   { id, type: 'result',   success, data?, error? }
 */

import type { PvacProgress } from './types'

// ─── Message types ────────────────────────────────────────────────────────────

export type WorkerOp =
  | 'decryptBalance'
  | 'encryptBalance'
  | 'decryptToPublic'
  | 'stealthSend'
  | 'stealthScan'
  | 'claimStealth'
  // Phase 7 — PVAC SDK ops (delegated from background via DAppRequestHandler)
  | 'pvacGetIdentity'
  | 'pvacComputeSharedSecret'
  | 'pvacDecryptCipher'
  | 'pvacEncryptValue'
  | 'pvacScanOutputs'
  // Lifecycle helpers — let the main thread keep WASM inside the worker only
  | 'warmup'
  | 'ensureRegistered'

export interface WorkerRequest {
  id: string
  op: WorkerOp
  payload: unknown
}

export interface WorkerProgressMessage {
  id: string
  type: 'progress'
  progress: PvacProgress
}

export interface WorkerResultMessage {
  id: string
  type: 'result'
  success: boolean
  data?: unknown
  error?: string
}

export type WorkerMessage = WorkerProgressMessage | WorkerResultMessage

// ─── Worker implementation ────────────────────────────────────────────────────

// Lazy-load ops inside the worker — avoids importing WASM on main thread
async function handleRequest(req: WorkerRequest): Promise<void> {
  const { id, op, payload } = req

  // Inject active RPC URL from main thread so makeRpcCall uses the correct network.
  // This is necessary because Web Workers cannot access localStorage.
  const raw = payload as Record<string, unknown>
  if (raw?._rpcUrl && typeof raw._rpcUrl === 'string') {
    ;(globalThis as Record<string, unknown>).__pvacWorkerRpcUrl = raw._rpcUrl
  }
  // Inject registration status from main thread (localStorage not available in workers)
  if (raw?._isRegistered === true) {
    ;(globalThis as Record<string, unknown>).__pvacIsRegistered = true
  } else {
    ;(globalThis as Record<string, unknown>).__pvacIsRegistered = false
  }

  const onProgress = (progress: PvacProgress) => {
    const msg: WorkerProgressMessage = { id, type: 'progress', progress }
    self.postMessage(msg)
  }

  try {
    let result: unknown

    switch (op) {
      case 'decryptBalance': {
        const { decryptBalance } = await import('./balance-ops')
        const input = payload as Parameters<typeof decryptBalance>[0]
        result = await decryptBalance(input, onProgress)
        break
      }
      case 'encryptBalance': {
        const { encryptBalance } = await import('./balance-ops')
        const raw = payload as Record<string, unknown>
        const fixedInput = { ...raw, amountRaw: BigInt(raw.amountRaw as string) } as Parameters<typeof encryptBalance>[0]
        result = await encryptBalance(fixedInput, onProgress)
        break
      }
      case 'decryptToPublic': {
        const { decryptToPublic } = await import('./balance-ops')
        const raw = payload as Record<string, unknown>
        const fixedInput = {
          ...raw,
          amountRaw: BigInt(raw.amountRaw as string),
        } as Parameters<typeof decryptToPublic>[0]
        result = await decryptToPublic(fixedInput, onProgress)
        break
      }
      case 'stealthSend': {
        const { stealthSend } = await import('./stealth-ops')
        const raw = payload as Record<string, unknown>
        const fixedInput = {
          ...raw,
          amountRaw: BigInt(raw.amountRaw as string),
        } as Parameters<typeof stealthSend>[0]
        result = await stealthSend(fixedInput, onProgress)
        break
      }
      case 'stealthScan': {
        const { stealthScan } = await import('./stealth-ops')
        const input = payload as Parameters<typeof stealthScan>[0]
        result = await stealthScan(input, onProgress)
        break
      }
      case 'claimStealth': {
        const { claimStealth } = await import('./stealth-ops')
        const input = payload as Parameters<typeof claimStealth>[0]
        result = await claimStealth(input, onProgress)
        break
      }

      // ── Phase 7: PVAC SDK ops ──────────────────────────────────────────────

      case 'pvacGetIdentity': {
        // Only need deriveViewKeypair, encodeBase64, resolveSecretKey64 for view key derivation
        const { deriveViewKeypair, encodeBase64, resolveSecretKey64 } = await import('./crypto-utils')
        const { makeRpcCall } = await import('@/services/rpcHelper')
        const raw = payload as { privateKey: string; walletAddress: string }

        const sk64 = resolveSecretKey64(raw.privateKey)
        const { viewPk } = await deriveViewKeypair(sk64)
        const viewPublicKey = encodeBase64(viewPk)

        // Check PVAC registration + current cipher from node
        let pvacRegistered = false
        let currentCipher = '0'
        try {
          const [pvacRes, cipherRes] = await Promise.all([
            makeRpcCall('octra_pvacPubkey', [raw.walletAddress]),
            makeRpcCall('octra_encryptedCipher', [raw.walletAddress]),
          ])
          pvacRegistered = !!(pvacRes as Record<string, unknown>)?.pvac_pubkey
          currentCipher = (cipherRes as Record<string, unknown>)?.cipher as string ?? '0'
        } catch { /* non-critical */ }

        result = {
          success: true,
          data: {
            identity: {
              ed25519PublicKey: raw.walletAddress,
              viewPublicKey,
              pvacRegistered,
              currentCipher,
            },
          },
        }
        break
      }

      case 'pvacComputeSharedSecret': {
        const { deriveViewKeypair, ecdhSharedSecret, computeStealthTag, computeClaimSecret, encodeBase64, encodeHex, resolveSecretKey64, decodeBase64 } = await import('./crypto-utils')
        const raw = payload as { privateKey: string; theirViewPubkey: string }

        const sk64 = resolveSecretKey64(raw.privateKey)
        const { viewSk } = await deriveViewKeypair(sk64)
        const theirPk = decodeBase64(raw.theirViewPubkey)

        const shared = await ecdhSharedSecret(viewSk, theirPk)
        const stealthTagBytes = await computeStealthTag(shared)
        const claimSecretBytes = await computeClaimSecret(shared)

        result = {
          success: true,
          data: {
            sharedSecretResult: {
              sharedSecret: encodeBase64(shared),
              stealthTag: encodeHex(stealthTagBytes),
              claimSecret: encodeBase64(claimSecretBytes),
            },
          },
        }
        break
      }

      case 'pvacDecryptCipher': {
        const { getPvacWasm } = await import('./wasm-loader')
        const raw = payload as { privateKey: string; cipher: string }

        if (!raw.cipher || raw.cipher === '0') {
          result = { success: true, data: { valueRaw: '0', valueOct: 0 } }
          break
        }

        onProgress({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 20 })
        const pvac = await getPvacWasm(raw.privateKey)

        onProgress({ step: 'decrypting', label: 'Decrypting cipher...', percent: 60 })
        const valueRaw = pvac.decryptValue(raw.cipher)
        const valueOct = Number(valueRaw) / 1_000_000

        onProgress({ step: 'done', label: 'Done', percent: 100 })
        result = { success: true, data: { valueRaw: valueRaw.toString(), valueOct } }
        break
      }

      case 'pvacEncryptValue': {
        const { getPvacWasm } = await import('./wasm-loader')
        const { ensurePvacRegisteredOnNode } = await import('./node-registration')
        const { resolveSecretKey64, hexPubkeyToBase64 } = await import('./crypto-utils')
        const raw = payload as { privateKey: string; publicKey: string; address: string; valueRaw: string }

        onProgress({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 15 })
        const sk64 = resolveSecretKey64(raw.privateKey)
        const publicKeyB64 = hexPubkeyToBase64(raw.publicKey)
        const pvac = await getPvacWasm(raw.privateKey)

        onProgress({ step: 'registering_pubkey', label: 'Checking PVAC registration...', percent: 25 })
        await ensurePvacRegisteredOnNode(pvac, raw.address, sk64, publicKeyB64)

        onProgress({ step: 'encrypting', label: 'Encrypting value...', percent: 60 })
        const seed = pvac.randomBytesPublic(32)
        const cipher = pvac.encryptValue(BigInt(raw.valueRaw), seed)

        onProgress({ step: 'done', label: 'Done', percent: 100 })
        result = { success: true, data: { cipher } }
        break
      }

      case 'pvacScanOutputs': {
        const { deriveViewKeypair, ecdhSharedSecret, computeStealthTag, computeClaimSecret, decryptStealthAmount, encodeBase64, encodeHex, resolveSecretKey64, decodeBase64 } = await import('./crypto-utils')
        const raw = payload as { privateKey: string; outputs: unknown[] }

        const sk64 = resolveSecretKey64(raw.privateKey)
        const { viewSk } = await deriveViewKeypair(sk64)

        const matched: unknown[] = []
        const total = raw.outputs.length

        for (let i = 0; i < total; i++) {
          const output = raw.outputs[i] as Record<string, unknown>
          try {
            // Skip already-claimed outputs — matches webcli main.cpp behavior.
            // The RPC returns all historical outputs with a `claimed` flag;
            // any non-zero value means this output has already been claimed
            // on-chain and should not be surfaced as claimable again.
            if (output.claimed !== undefined && output.claimed !== 0 && output.claimed !== false) continue

            if (!output.eph_pub || !output.stealth_tag || !output.enc_amount) continue

            const ephPk = decodeBase64(output.eph_pub as string)
            const shared = await ecdhSharedSecret(viewSk, ephPk)
            const computedTagBytes = await computeStealthTag(shared)
            const computedTag = encodeHex(computedTagBytes)
            const outputTag = (output.stealth_tag as string).replace(/^0x/, '').toLowerCase()

            if (computedTag !== outputTag) continue

            // Tag matches — decrypt amount
            const decrypted = await decryptStealthAmount(shared, output.enc_amount as string)
            const amountRaw = decrypted?.amountRaw ?? 0n
            const blinding = decrypted?.blinding ? encodeBase64(decrypted.blinding) : ''

            const claimSecretBytes = await computeClaimSecret(shared)
            const claimSecret = encodeBase64(claimSecretBytes)

            matched.push({
              id: String(output.id ?? ''),
              amountRaw: amountRaw.toString(),
              amountOct: Number(amountRaw) / 1_000_000,
              epochId: output.epoch_id ?? 0,
              senderAddress: output.sender_addr ?? '',
              txHash: output.tx_hash ?? '',
              claimSecret,
              blinding,
              rawOutput: output,
            })
          } catch { /* skip malformed output */ }

          // Emit progress every 50 outputs
          if (i % 50 === 0) {
            onProgress({
              step: 'scanning',
              label: `Scanning outputs... (${i + 1}/${total})`,
              percent: Math.round(10 + (i / total) * 85),
            })
          }
        }

        onProgress({ step: 'done', label: 'Scan complete', percent: 100 })
        result = {
          success: true,
          data: {
            scanResult: {
              outputs: matched,
              totalScanned: total,
              matched: matched.length,
            },
          },
        }
        break
      }
      // ── Lifecycle helpers ─────────────────────────────────────────────────
      // These keep WASM inside the worker so main-thread callers never need to
      // import wasm-loader. Same singleton is reused for all subsequent ops.

      case 'warmup': {
        const { getPvacWasm } = await import('./wasm-loader')
        const raw = payload as { privateKey: string }
        onProgress({ step: 'keygen', label: 'Warming up PVAC engine...', percent: 50 })
        await getPvacWasm(raw.privateKey)
        onProgress({ step: 'done', label: 'Ready', percent: 100 })
        result = { success: true, data: { warmed: true } }
        break
      }

      case 'ensureRegistered': {
        const { getPvacWasm } = await import('./wasm-loader')
        const { ensurePvacRegisteredOnNode } = await import('./node-registration')
        const { resolveSecretKey64, hexPubkeyToBase64 } = await import('./crypto-utils')
        const raw = payload as {
          privateKey: string
          publicKey: string
          address: string
        }
        onProgress({ step: 'keygen', label: 'Deriving PVAC keys...', percent: 20 })
        const pvac = await getPvacWasm(raw.privateKey)
        const sk64 = resolveSecretKey64(raw.privateKey)
        const publicKeyB64 = hexPubkeyToBase64(raw.publicKey)
        onProgress({ step: 'registering_pubkey', label: 'Checking PVAC registration...', percent: 60 })
        const regResult = await ensurePvacRegisteredOnNode(pvac, raw.address, sk64, publicKeyB64)
        onProgress({ step: 'done', label: 'Done', percent: 100 })
        result = {
          success: regResult.success,
          data: regResult.success ? { alreadyRegistered: !!regResult.alreadyRegistered } : undefined,
          error: regResult.error,
        }
        break
      }

      default:
        throw new Error(`Unknown op: ${op}`)
    }

    // result is PvacResult<T> — spread its fields into the message
    const pvacResult = result as { success: boolean; data?: unknown; error?: string }
    const msg: WorkerResultMessage = {
      id,
      type: 'result',
      success: pvacResult.success,
      data: pvacResult.data,
      error: pvacResult.error,
    }
    self.postMessage(msg)
  } catch (error) {
    const msg: WorkerResultMessage = {
      id,
      type: 'result',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(msg)
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  handleRequest(event.data)
})
