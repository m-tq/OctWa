import type { Capability, CapabilityState } from './types';
import { CapabilityExpiredError, CapabilityRevokedError, CapabilityError } from './errors';

export class CapabilityService {
  private readonly capabilities = new Map<string, Capability>();

  add(capability: Capability): void {
    this.capabilities.set(capability.id, capability);
  }

  get(capabilityId: string): Capability | undefined {
    return this.capabilities.get(capabilityId);
  }

  getActive(): Capability[] {
    this.cleanupExpired();
    return Array.from(this.capabilities.values()).filter((cap) => cap.state === 'ACTIVE');
  }

  validate(capabilityId: string): void {
    const capability = this.capabilities.get(capabilityId);

    if (!capability) {
      throw new CapabilityError(`Capability '${capabilityId}' not found`);
    }
    if (capability.state === 'REVOKED') {
      throw new CapabilityRevokedError(capabilityId);
    }
    if (capability.state === 'EXPIRED' || this.isExpired(capability)) {
      throw new CapabilityExpiredError(capabilityId, capability.expiresAt);
    }
  }

  isMethodAllowed(capabilityId: string, method: string): boolean {
    return this.capabilities.get(capabilityId)?.methods.includes(method) ?? false;
  }

  updateState(capabilityId: string, state: CapabilityState): void {
    const capability = this.capabilities.get(capabilityId);
    if (capability) capability.state = state;
  }

  revoke(capabilityId: string): void {
    this.updateState(capabilityId, 'REVOKED');
  }

  remove(capabilityId: string): void {
    this.capabilities.delete(capabilityId);
  }

  clearAll(): void {
    this.capabilities.clear();
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const cap of this.capabilities.values()) {
      if (cap.expiresAt < now) cap.state = 'EXPIRED';
    }
  }

  private isExpired(capability: Capability): boolean {
    return capability.expiresAt < Date.now();
  }
}
