import type { GasEstimate, EncryptedPayload } from './types';

const OCT_PER_OU = 1 / 1_000_000; // 1 OCT = 1,000,000 OU

/**
 * GasService — fee estimation for Octra transactions.
 *
 * Fallback values are used when the wallet provider does not return
 * a live estimate. The wallet always fetches live fees from the node
 * via octra_recommendedFee — these are only used client-side for
 * pre-flight display.
 */
export class GasService {
  /** Fallback OU for standard transactions. */
  private static readonly STANDARD_OU = 1_000;
  /** Fallback OU for encrypted transactions. */
  private static readonly ENCRYPT_OU  = 30_000;

  /**
   * Estimate fee for a plain (unencrypted) transaction.
   * Uses fallback OU — wallet will fetch live value from node.
   */
  estimatePlainTx(_payload: unknown): GasEstimate {
    const ou  = GasService.STANDARD_OU;
    const fee = ou * OCT_PER_OU;
    return { gasUnits: ou, tokenCost: fee, latencyEstimate: 2000, epoch: 0 };
  }

  /**
   * Estimate fee for an encrypted (HFHE) transaction.
   * Uses fallback OU — wallet will fetch live value from node.
   */
  estimateEncryptedTx(_payload: EncryptedPayload): GasEstimate {
    const ou  = GasService.ENCRYPT_OU;
    const fee = ou * OCT_PER_OU;
    return { gasUnits: ou, tokenCost: fee, latencyEstimate: 4000, epoch: 0 };
  }

  /** Calculate OCT fee for a given OU value. */
  calculateFee(ou: number): number {
    return ou * OCT_PER_OU;
  }
}
