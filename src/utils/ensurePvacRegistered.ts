/**
 * Ensures the wallet's PVAC public key is registered on the node before any
 * encrypt/decrypt/stealth operation. The node rejects unregistered wallets with:
 *   "bad_zero_proof : encrypt [reason - no pvac pubkey registered]"
 *
 * Registration is one-shot per (wallet, network). The main thread short-circuits
 * via the shared localStorage cache and only delegates to the worker when a
 * real on-chain check is needed. This keeps PVAC WASM strictly inside the
 * worker — no main-thread WASM loader imports anywhere in this module.
 */

import { runInWorker } from '@/lib/pvac/pvac-worker-client';
import { isPvacRegistered, markPvacRegistered } from '@/lib/pvac/node-registration';
import { getActiveRPCProvider } from '@/utils/rpc';

export interface EnsurePvacResult {
  success: boolean;
  alreadyRegistered?: boolean;
  error?: string;
}

export async function ensurePvacRegistered(
  address: string,
  privateKey: string,
  publicKey: string,
): Promise<EnsurePvacResult> {
  const provider = getActiveRPCProvider();
  const networkUrl = provider?.url ?? 'unknown';

  // Fast path — already registered on this network, no worker round-trip.
  if (isPvacRegistered(address, networkUrl)) {
    return { success: true, alreadyRegistered: true };
  }

  try {
    const result = await runInWorker<{ alreadyRegistered: boolean }>('ensureRegistered', {
      privateKey,
      publicKey,
      address,
    });

    if (result.success) {
      // Worker's localStorage is empty (wrong context) — persist the result
      // here so subsequent main-thread checks short-circuit.
      markPvacRegistered(address, networkUrl);
      return {
        success: true,
        alreadyRegistered: !!result.data?.alreadyRegistered,
      };
    }

    return { success: false, error: result.error ?? 'Registration failed' };
  } catch (error) {
    console.error('[ensurePvacRegistered] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
