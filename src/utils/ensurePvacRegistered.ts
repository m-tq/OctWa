/**
 * Ensures the wallet's PVAC public key is registered on the node before any
 * encrypt/decrypt/stealth operation. The node rejects unregistered wallets with:
 *   "bad_zero_proof : encrypt [reason - no pvac pubkey registered]"
 *
 * Uses the browser WASM engine — no local server required.
 * Safe to call before every PVAC operation — idempotent.
 */

import { getPvacWasm } from '@/lib/pvac/wasm-loader';
import { ensurePvacRegisteredOnNode } from '@/lib/pvac/node-registration';
import { resolveSecretKey64, hexPubkeyToBase64 } from '@/lib/pvac/crypto-utils';

export interface EnsurePvacResult {
  success: boolean;
  alreadyRegistered?: boolean;
  error?: string;
}

export async function ensurePvacRegistered(
  address: string,
  privateKey: string,
  publicKey: string
): Promise<EnsurePvacResult> {
  try {
    const pvac = await getPvacWasm(privateKey);
    const sk64 = resolveSecretKey64(privateKey);
    const publicKeyB64 = hexPubkeyToBase64(publicKey);

    const result = await ensurePvacRegisteredOnNode(pvac, address, sk64, publicKeyB64);

    return result;
  } catch (error) {
    console.error('[ensurePvacRegistered] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
