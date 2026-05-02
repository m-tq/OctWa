import type { Capability } from './types';
import { isCapabilityExpired, isOriginValid, validateCapability } from './crypto';

export interface CapabilityValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Manages capability lifecycle and validation for the current page session.
 * Not persisted — cleared on page reload.
 *
 * Security: signature verification, origin binding, expiry, method scope,
 * and a max-capability limit to prevent DoS.
 */
export class CapabilityManager {
  private readonly capabilities = new Map<string, Capability>();
  private readonly nonceMap = new Map<string, number>();
  private readonly currentOrigin: string;
  private static readonly MAX_CAPABILITIES = 100;

  constructor(origin?: string) {
    this.currentOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  }

  async addCapability(cap: Capability): Promise<CapabilityValidationResult> {
    if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
      this.cleanupExpired();
      if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
        console.warn('[CapabilityManager] Maximum capability limit reached');
        return { valid: false, error: 'Maximum capability limit reached' };
      }
    }

    const validation = await validateCapability(cap, this.currentOrigin);
    if (!validation.valid) {
      console.warn('[CapabilityManager] Rejected invalid capability:', validation.error);
      return validation;
    }

    this.capabilities.set(cap.id, cap);
    if (!this.nonceMap.has(cap.id)) this.nonceMap.set(cap.id, 0);

    return { valid: true };
  }

  addCapabilityTrusted(cap: Capability): void {
    if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
      this.cleanupExpired();
      if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
        const oldestId = this.capabilities.keys().next().value;
        if (oldestId) {
          this.capabilities.delete(oldestId);
          this.nonceMap.delete(oldestId);
        }
      }
    }

    this.capabilities.set(cap.id, cap);
    if (!this.nonceMap.has(cap.id)) this.nonceMap.set(cap.id, 0);
  }

  getCapability(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  removeCapability(id: string): void {
    this.capabilities.delete(id);
    this.nonceMap.delete(id);
  }

  getActiveCapabilities(): Capability[] {
    return Array.from(this.capabilities.values()).filter((cap) => !isCapabilityExpired(cap));
  }

  isCapabilityValid(id: string): boolean {
    const cap = this.capabilities.get(id);
    return !!cap && !isCapabilityExpired(cap) && isOriginValid(cap, this.currentOrigin);
  }

  async validateCapabilityFull(id: string): Promise<CapabilityValidationResult> {
    const cap = this.capabilities.get(id);
    if (!cap) return { valid: false, error: 'Capability not found' };
    return validateCapability(cap, this.currentOrigin);
  }

  getNextNonce(capabilityId: string): number {
    const next = (this.nonceMap.get(capabilityId) ?? 0) + 1;
    this.nonceMap.set(capabilityId, next);
    return next;
  }

  getCurrentNonce(capabilityId: string): number {
    return this.nonceMap.get(capabilityId) ?? 0;
  }

  clearAll(): void {
    this.capabilities.clear();
    this.nonceMap.clear();
  }

  cleanupExpired(): void {
    for (const [id, cap] of this.capabilities.entries()) {
      if (isCapabilityExpired(cap)) {
        this.capabilities.delete(id);
        this.nonceMap.delete(id);
      }
    }
  }

  isMethodAllowed(capabilityId: string, method: string): boolean {
    return this.capabilities.get(capabilityId)?.methods.includes(method) ?? false;
  }

  getCapabilityForMethod(method: string): Capability | undefined {
    for (const cap of this.capabilities.values()) {
      if (!isCapabilityExpired(cap) && isOriginValid(cap, this.currentOrigin) && cap.methods.includes(method)) {
        return cap;
      }
    }
    return undefined;
  }
}
