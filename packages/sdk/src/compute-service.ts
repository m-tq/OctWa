import type { ComputeRequest, ComputeProfile, EncryptedPayload } from './types';

export class ComputeService {
  createComputeRequest(params: {
    circleId: string;
    capabilityId: string;
    branchId: string;
    circuitId: string;
    encryptedInput: EncryptedPayload;
    computeProfile: ComputeProfile;
    gasLimit: number;
  }): ComputeRequest {
    return {
      circleId: params.circleId,
      capabilityId: params.capabilityId,
      branchId: params.branchId,
      circuitId: params.circuitId,
      encryptedInput: params.encryptedInput,
      computeProfile: params.computeProfile,
      gasLimit: params.gasLimit,
    };
  }
  
  validateComputeProfile(profile: ComputeProfile): void {
    if (profile.gateCount <= 0) {
      throw new Error('Gate count must be positive');
    }
    
    if (profile.vectorSize <= 0) {
      throw new Error('Vector size must be positive');
    }
    
    if (profile.depth <= 0) {
      throw new Error('Depth must be positive');
    }
    
    if (profile.expectedBootstrap < 0) {
      throw new Error('Expected bootstrap must be non-negative');
    }
  }
  
  estimateComputeCost(profile: ComputeProfile): number {
    const bootstrapFactor = 1 + (profile.expectedBootstrap * 0.5);
    return profile.gateCount * profile.depth * bootstrapFactor;
  }
}
