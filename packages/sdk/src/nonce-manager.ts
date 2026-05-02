import { NonceViolationError } from './errors';

export class NonceManager {
  private readonly nonces = new Map<string, number>();

  getNextNonce(capabilityId: string): number {
    const next = (this.nonces.get(capabilityId) ?? 0) + 1;
    this.nonces.set(capabilityId, next);
    return next;
  }

  getCurrentNonce(capabilityId: string): number {
    return this.nonces.get(capabilityId) ?? 0;
  }

  validateNonce(capabilityId: string, nonce: number): void {
    const lastNonce = this.nonces.get(capabilityId) ?? 0;
    if (nonce <= lastNonce) {
      throw new NonceViolationError(capabilityId, lastNonce, nonce);
    }
  }

  updateNonce(capabilityId: string, nonce: number): void {
    this.validateNonce(capabilityId, nonce);
    this.nonces.set(capabilityId, nonce);
  }

  resetNonce(capabilityId: string, baseNonce = 0): void {
    this.nonces.set(capabilityId, baseNonce);
  }

  clearAll(): void {
    this.nonces.clear();
  }

  remove(capabilityId: string): void {
    this.nonces.delete(capabilityId);
  }
}
