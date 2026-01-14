import type { Capability } from './types';

/**
 * Manages capability lifecycle and validation.
 * Capabilities are NOT persisted - cleared on page reload.
 */
export class CapabilityManager {
  private capabilities: Map<string, Capability> = new Map();
  private nonceMap: Map<string, number> = new Map();

  /**
   * Add a capability to the manager
   */
  addCapability(cap: Capability): void {
    this.capabilities.set(cap.id, cap);
    // Initialize nonce for this capability
    if (!this.nonceMap.has(cap.id)) {
      this.nonceMap.set(cap.id, 0);
    }
  }

  /**
   * Get a capability by ID
   */
  getCapability(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Remove a capability by ID
   */
  removeCapability(id: string): void {
    this.capabilities.delete(id);
    this.nonceMap.delete(id);
  }

  /**
   * Get all active (non-expired) capabilities
   */
  getActiveCapabilities(): Capability[] {
    const now = Date.now();
    const active: Capability[] = [];

    for (const cap of this.capabilities.values()) {
      if (this.isCapabilityValidInternal(cap, now)) {
        active.push(cap);
      }
    }

    return active;
  }

  /**
   * Check if a capability is valid (exists and not expired)
   */
  isCapabilityValid(id: string): boolean {
    const cap = this.capabilities.get(id);
    if (!cap) return false;
    return this.isCapabilityValidInternal(cap, Date.now());
  }

  /**
   * Get the next nonce for a capability (monotonically increasing)
   */
  getNextNonce(capabilityId: string): number {
    const current = this.nonceMap.get(capabilityId) ?? 0;
    const next = current + 1;
    this.nonceMap.set(capabilityId, next);
    return next;
  }

  /**
   * Get current nonce without incrementing
   */
  getCurrentNonce(capabilityId: string): number {
    return this.nonceMap.get(capabilityId) ?? 0;
  }

  /**
   * Clear all capabilities and nonces
   */
  clearAll(): void {
    this.capabilities.clear();
    this.nonceMap.clear();
  }

  /**
   * Remove expired capabilities from the manager
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [id, cap] of this.capabilities.entries()) {
      if (!this.isCapabilityValidInternal(cap, now)) {
        this.capabilities.delete(id);
        this.nonceMap.delete(id);
      }
    }
  }

  /**
   * Check if a method is allowed by a capability
   */
  isMethodAllowed(capabilityId: string, method: string): boolean {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return false;
    return cap.methods.includes(method);
  }

  /**
   * Internal validity check
   */
  private isCapabilityValidInternal(cap: Capability, now: number): boolean {
    // Check expiry
    if (cap.expiresAt !== undefined && cap.expiresAt < now) {
      return false;
    }
    return true;
  }
}
