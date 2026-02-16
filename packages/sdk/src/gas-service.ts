import type { GasEstimate, ComputeProfile, EncryptedPayload } from './types';

/**
 * GasService - Estimates gas costs for Octra transactions
 * 
 * Gas Formula (from OctWa wallet):
 * - Fee = OU * 0.0000001 OCT
 * - Default OU: 10,000 (for amounts < 1000 OCT)
 * - High OU: 30,000 (for amounts >= 1000 OCT)
 * - Custom OU: User-defined
 */
export class GasService {
  /**
   * Estimate gas for plain transaction
   * 
   * @param payload - Transaction payload (includes amount, recipient, message)
   * @returns Gas estimate with OU (gas units) and token cost
   */
  estimatePlainTx(payload: unknown): GasEstimate {
    // Extract amount from payload to determine OU
    let amount = 0;
    
    if (payload && typeof payload === 'object') {
      const payloadObj = payload as Record<string, unknown>;
      if ('amount' in payloadObj && typeof payloadObj.amount === 'number') {
        amount = payloadObj.amount;
      }
    }
    
    // Determine OU based on amount (auto mode logic from OctWa)
    // < 1000 OCT: 10,000 OU
    // >= 1000 OCT: 30,000 OU
    const ou = amount < 1000 ? 10000 : 30000;
    
    // Calculate fee: OU * 0.0000001
    const fee = ou * 0.0000001;
    
    return {
      gasUnits: ou,
      tokenCost: fee,
      latencyEstimate: 2000, // ~2 seconds for transaction confirmation
      epoch: 0, // PENDING: Will be set when epoch implementation is ready
    };
  }
  
  /**
   * Estimate gas for encrypted transaction (HFHE)
   * 
   * Encrypted transactions have higher OU due to encryption overhead
   */
  estimateEncryptedTx(payload: EncryptedPayload): GasEstimate {
    // Encrypted transactions use higher OU
    const baseOu = 30000;
    const encryptionOverhead = 1.5;
    const ou = Math.ceil(baseOu * encryptionOverhead);
    
    // Calculate fee: OU * 0.0000001
    const fee = ou * 0.0000001;
    
    return {
      gasUnits: ou,
      tokenCost: fee,
      latencyEstimate: 4000, // ~4 seconds for encrypted tx
      epoch: 0, // PENDING
    };
  }
  
  /**
   * Estimate cost for HFHE computation
   * 
   * Compute operations have variable OU based on complexity
   */
  estimateComputeCost(profile: ComputeProfile): GasEstimate {
    const {
      gateCount,
      vectorSize,
      depth,
      expectedBootstrap,
    } = profile;
    
    // Calculate OU based on computation complexity
    const gateOu = gateCount * 10;
    const vectorOu = vectorSize * 5;
    const depthOu = depth * 20;
    const bootstrapOu = expectedBootstrap * 1000;
    
    const totalOu = gateOu + vectorOu + depthOu + bootstrapOu;
    
    // Calculate fee: OU * 0.0000001
    const fee = totalOu * 0.0000001;
    
    return {
      gasUnits: totalOu,
      tokenCost: fee,
      latencyEstimate: (gateCount * depth * 10) + (expectedBootstrap * 1000),
      epoch: 0, // PENDING
    };
  }
  
  /**
   * Calculate fee for custom OU value
   * 
   * @param ou - Custom OU value
   * @returns Fee in OCT
   */
  calculateFee(ou: number): number {
    return ou * 0.0000001;
  }
  
  /**
   * Get recommended OU for transaction amount
   * 
   * @param amount - Transaction amount in OCT
   * @returns Recommended OU value
   */
  getRecommendedOu(amount: number): number {
    if (amount < 1000) {
      return 10000; // Low OU for small transactions
    } else {
      return 30000; // High OU for large transactions
    }
  }
}
