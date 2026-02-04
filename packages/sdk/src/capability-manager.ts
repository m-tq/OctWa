import type { Capability } from './types';
import {
  isCapabilityExpired,
  isOriginValid,
  validateCapability
} from './crypto';

/**
 * Capability validation result
 */
export interface CapabilityValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Manages capability lifecycle and validation.
 * Capabilities are NOT persisted - cleared on page reload.
 * 
 * Key security features:
 * - Cryptographic signature verification before use
 * - Origin binding enforcement
 * - Expiry checking
 * - Method scope enforcement
 * - Maximum capability limit to prevent DoS
 */
export class CapabilityManager {
  private capabilities: Map<string, Capability> = new Map();
  private nonceMap: Map<string, number> = new Map();
  private currentOrigin: string;
  private static readonly MAX_CAPABILITIES = 100; // Prevent DoS via capability flooding

  constructor(origin?: string) {
    this.currentOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  }

  /**
   * Add a capability after cryptographic verification
   * 
   * @throws Error if capability signature is invalid
   */
  async addCapability(cap: Capability): Promise<CapabilityValidationResult> {
    // Check capacity limit
    if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
      // Clean up expired first
      this.cleanupExpired();
      // If still at limit, reject
      if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
        console.warn('[CapabilityManager] Maximum capability limit reached');
        return { valid: false, error: 'Maximum capability limit reached' };
      }
    }

    // Verify signature before accepting
    const validation = await validateCapability(cap, this.currentOrigin);
    
    if (!validation.valid) {
      console.warn('[CapabilityManager] Rejected invalid capability:', validation.error);
      return validation;
    }
    
    this.capabilities.set(cap.id, cap);
    
    // Initialize nonce for this capability
    if (!this.nonceMap.has(cap.id)) {
      this.nonceMap.set(cap.id, 0);
    }
    
    return { valid: true };
  }

  /**
   * Add capability without verification (for trusted sources like wallet)
   * Use with caution - only for capabilities directly from the wallet provider
   */
  addCapabilityTrusted(cap: Capability): void {
    // Check capacity limit even for trusted sources
    if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
      this.cleanupExpired();
      if (this.capabilities.size >= CapabilityManager.MAX_CAPABILITIES) {
        console.warn('[CapabilityManager] Maximum capability limit reached, removing oldest');
        // Remove oldest capability to make room
        const oldestId = this.capabilities.keys().next().value;
        if (oldestId) {
          this.capabilities.delete(oldestId);
          this.nonceMap.delete(oldestId);
        }
      }
    }
    
    this.capabilities.set(cap.id, cap);
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
    const active: Capability[] = [];

    for (const cap of this.capabilities.values()) {
      if (!isCapabilityExpired(cap)) {
        active.push(cap);
      }
    }

    return active;
  }

  /**
   * Check if a capability is valid (exists, not expired, origin matches)
   */
  isCapabilityValid(id: string): boolean {
    const cap = this.capabilities.get(id);
    if (!cap) return false;
    
    // Check expiry
    if (isCapabilityExpired(cap)) {
      return false;
    }
    
    // Check origin binding
    if (!isOriginValid(cap, this.currentOrigin)) {
      return false;
    }
    
    return true;
  }

  /**
   * Async validation including signature verification
   */
  async validateCapabilityFull(id: string): Promise<CapabilityValidationResult> {
    const cap = this.capabilities.get(id);
    if (!cap) {
      return { valid: false, error: 'Capability not found' };
    }
    
    return validateCapability(cap, this.currentOrigin);
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
    for (const [id, cap] of this.capabilities.entries()) {
      if (isCapabilityExpired(cap)) {
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
   * Get capability for a specific method (finds first valid capability that allows the method)
   */
  getCapabilityForMethod(method: string): Capability | undefined {
    for (const cap of this.capabilities.values()) {
      if (!isCapabilityExpired(cap) && 
          isOriginValid(cap, this.currentOrigin) && 
          cap.methods.includes(method)) {
        return cap;
      }
    }
    return undefined;
  }
}
