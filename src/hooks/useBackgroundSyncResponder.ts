import { useEffect } from 'react';
import { Wallet } from '../types/wallet';
import { deriveEvmFromOctraKey } from '../utils/evmDerive';

/**
 * Responds to background service worker messages that need wallet-side
 * processing:
 *
 * 1. BG_EVM_ADDRESS_REQUEST — derive and return the EVM address for a
 *    given Octra address (background can't access the session keys).
 *
 * 2. SYNC_RPC_PROVIDERS — mirror the rpcProviders + selectedNetwork
 *    changes to localStorage so the wallet UI picks them up (background
 *    can't write to localStorage).
 *
 * Also performs a one-shot localStorage → chrome.storage.local sync on
 * mount so the background service worker always sees the user-visible
 * settings (network, RPC providers, EVM chain) without relying on
 * cross-context messaging.
 */
export function useBackgroundSyncResponder(wallets: Wallet[]) {
  // One-shot sync from localStorage → chrome.storage.local on mount.
  // The background service worker has no localStorage access, so any
  // user-driven UI changes that wrote to localStorage must be mirrored
  // here for the background to see the same state.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      const updates: Record<string, string> = {};

      const activeEvmNetwork = localStorage.getItem('active_evm_network');
      if (activeEvmNetwork) updates.active_evm_network = activeEvmNetwork;

      const rpcProviders = localStorage.getItem('rpcProviders');
      if (rpcProviders) updates.rpcProviders = rpcProviders;

      const selectedNetwork = localStorage.getItem('selectedNetwork');
      if (selectedNetwork) updates.selectedNetwork = selectedNetwork;

      if (Object.keys(updates).length > 0) {
        chrome.storage.local.set(updates).catch(() => {});
      }
    } catch (e) {
      console.warn('[useBackgroundSyncResponder] Initial sync failed:', e);
    }
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    const listener = (
      message: Record<string, unknown>,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      // ── EVM address derivation delegation ──────────────────────────────
      if (message.type === 'BG_EVM_ADDRESS_REQUEST') {
        const octraAddress = message.octraAddress as string;
        const requestId = message.requestId as string;
        const wallet = wallets.find(w => w.address === octraAddress);
        if (wallet?.privateKey) {
          try {
            const { evmAddress } = deriveEvmFromOctraKey(wallet.privateKey);
            chrome.runtime.sendMessage({
              type: 'BG_EVM_ADDRESS_RESPONSE',
              requestId,
              evmAddress,
            }).catch(() => {});
          } catch {
            chrome.runtime.sendMessage({
              type: 'BG_EVM_ADDRESS_RESPONSE',
              requestId,
              evmAddress: null,
            }).catch(() => {});
          }
        }
        return false;
      }

      // ── RPC providers sync (background → localStorage) ─────────────────
      if (message.type === 'SYNC_RPC_PROVIDERS') {
        try {
          const rpcProviders = message.rpcProviders as string | undefined;
          const selectedNetwork = message.selectedNetwork as string | undefined;
          if (rpcProviders) {
            localStorage.setItem('rpcProviders', rpcProviders);
          }
          if (selectedNetwork) {
            localStorage.setItem('selectedNetwork', selectedNetwork);
          }
          // Trigger any localStorage-watching components to pick up the change
          // by dispatching a storage event (same-tab storage events don't fire
          // automatically — only cross-tab).
          window.dispatchEvent(new StorageEvent('storage', {
            key: 'rpcProviders',
            newValue: rpcProviders ?? null,
          }));
        } catch (e) {
          console.warn('[useBackgroundSyncResponder] Failed to sync:', e);
        }
        sendResponse({ ok: true });
        return false;
      }

      // ── EVM network sync (background → localStorage) ───────────────────
      if (message.type === 'SYNC_EVM_NETWORK') {
        try {
          const activeEvmNetwork = message.activeEvmNetwork as string | undefined;
          if (activeEvmNetwork) {
            localStorage.setItem('active_evm_network', activeEvmNetwork);
          }
        } catch (e) {
          console.warn('[useBackgroundSyncResponder] Failed to sync EVM network:', e);
        }
        sendResponse({ ok: true });
        return false;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [wallets]);
}
