import { useEffect } from 'react'
import type { Wallet } from '@/types/wallet'

/**
 * Listen for BG_DECRYPT_BALANCE_REQUEST messages from the service worker
 * and respond with a freshly-decrypted encrypted balance for the requested
 * address.
 *
 * The MV3 service worker can't host a Web Worker (no DedicatedWorker
 * scope), so background.js delegates the PVAC decrypt to whichever wallet
 * page (popup / expanded view / dApp request handler) is currently open.
 * Mount this hook anywhere the unlocked wallet is in scope. Multiple
 * mounted listeners are fine — the first response wins because background
 * matches by `requestId`.
 */
export function useBackgroundDecryptResponder(wallets: Wallet[] | null | undefined): void {
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return
    if (!wallets || wallets.length === 0) return

    const listener = (msg: unknown) => {
      const m = msg as { type?: string; requestId?: string; address?: string }
      if (m?.type !== 'BG_DECRYPT_BALANCE_REQUEST' || !m.requestId || !m.address) return

      const wallet = wallets.find(
        (w) => w.address.toLowerCase() === String(m.address).toLowerCase(),
      )

      // Resolve asynchronously, regardless of whether the wallet was found.
      // Background times out at ~4s if we never reply, so always send back
      // a definitive answer.
      void (async () => {
        let decryptedAmount: string | undefined
        try {
          if (wallet?.privateKey) {
            const { fetchEncryptedBalance } = await import('@/utils/api')
            const result = await fetchEncryptedBalance(wallet.address, wallet.privateKey, true)
            const raw = result?.encrypted_raw
            if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
              decryptedAmount = String(raw)
            }
          }
        } catch (err) {
          console.warn('[BG_DECRYPT_BALANCE_REQUEST] failed', err)
        }

        try {
          chrome.runtime.sendMessage({
            type: 'BG_DECRYPT_BALANCE_RESPONSE',
            requestId: m.requestId,
            success: decryptedAmount !== undefined,
            decryptedAmount,
          })
        } catch { /* nothing to do */ }
      })()

      // Returning false keeps the channel open for other listeners.
      return false
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => {
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [wallets])
}
