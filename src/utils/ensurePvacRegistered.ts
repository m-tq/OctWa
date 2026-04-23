/**
 * ensurePvacRegistered
 *
 * Before any encrypt / decrypt / stealth operation the node requires the
 * wallet's PVAC public key to be registered via octra_registerPvacPubkey.
 * Without it the node rejects the tx with:
 *   "bad_zero_proof : encrypt [reason - no pvac pubkey registered]"
 *
 * Flow:
 *   1. Call PVAC server POST /api/ensure_pvac_registered
 *      → server derives PVAC pubkey, checks node, registers if needed
 *   2. Return success/error to caller
 *
 * This is idempotent — safe to call before every PVAC operation.
 * Requires PVAC server to be rebuilt with the new endpoint.
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
