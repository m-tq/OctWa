import { NonceViolationError } from './errors';

export class NonceManager {
  private nonces: Map<string, number> = new Map();
  
  getNextNonce(capabilityId: string): number {
    const current = this.nonces.get(capabilityId) || 0;
    const next = current + 1;
    this.nonces.set(capabilityId, next);
    return next;
  }
  
  getCurrentNonce(capabilityId: string): number {
    return this.nonces.get(capabilityId) || 0;
  }
  
  validateNonce(capabilityId: string, nonce: number): void {
    const lastNonce = this.nonces.get(capabilityId) || 0;
    
    if (nonce <= lastNonce) {
      throw new NonceViolationError(capabilityId, lastNonce, nonce);
    }
  }
  
  updateNonce(capabilityId: string, nonce: number): void {
    this.validateNonce(capabilityId, nonce);
    this.nonces.set(capabilityId, nonce);
  }
  
  resetNonce(capabilityId: string, baseNonce: number = 0): void {
    this.nonces.set(capabilityId, baseNonce);
  }
  
  clearAll(): void {
    this.nonces.clear();
  }
  
  remove(capabilityId: string): void {
    this.nonces.delete(capabilityId);
  }
}
