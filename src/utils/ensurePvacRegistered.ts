/**
 * Ensures the wallet's PVAC public key is registered on the node before any
 * encrypt/decrypt/stealth operation. The node rejects unregistered wallets with:
 *   "bad_zero_proof : encrypt [reason - no pvac pubkey registered]"
 *
 * Delegates to the PVAC server's /api/ensure_pvac_registered endpoint.
 * Safe to call before every PVAC operation — the server is idempotent.
 */

import { pvacServerService } from '@/services/pvacServerService';
import { getActiveRPCProvider } from '@/utils/rpc';

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
    const rpcUrl = getActiveRPCProvider()?.url || '';
    if (!rpcUrl) {
      return { success: false, error: 'No RPC provider configured' };
    }

    const result = await pvacServerService.ensurePvacRegistered({
      private_key: privateKey,
      public_key: publicKey,
      address,
      rpc_url: rpcUrl,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'PVAC registration failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('[ensurePvacRegistered] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
