/**
 * Capability-based permission model for wallet operations
 * dApps must request specific capabilities and users can grant/revoke them
 */

/**
 * Wallet capabilities that can be requested by dApps
 */
export type WalletCapability =
  | 'tx_sign'                    // Sign and send transactions
  | 'runtime_execute'            // Execute runtime operations
  | 'decrypt_result'             // Decrypt encrypted results
  | 'reencrypt_for_third_party'  // Re-encrypt data for another party
  | 'view_address'               // View wallet address
  | 'view_balance';              // View wallet balance

/**
 * All available wallet capabilities
 */
export const ALL_CAPABILITIES: WalletCapability[] = [
  'tx_sign',
  'runtime_execute',
  'decrypt_result',
  'reencrypt_for_third_party',
  'view_address',
  'view_balance',
];

/**
 * Human-readable descriptions for capabilities
 */
export const CAPABILITY_DESCRIPTIONS: Record<WalletCapability, string> = {
  tx_sign: 'Sign and send transactions on your behalf',
  runtime_execute: 'Execute runtime operations',
  decrypt_result: 'Decrypt encrypted data and results',
  reencrypt_for_third_party: 'Re-encrypt your data for sharing with others',
  view_address: 'View your wallet address',
  view_balance: 'View your wallet balance',
};

/**
 * Request from a dApp to obtain wallet capabilities
 */
export interface CapabilityRequest {
  /** Origin URL of the requesting dApp */
  origin: string;

  /** Display name of the dApp */
  appName: string;

  /** Icon URL for the dApp (optional) */
  appIcon?: string;

  /** Capabilities being requested */
  capabilities: WalletCapability[];

  /** Timestamp when request was made */
  timestamp: number;
}

/**
 * Record of capabilities granted to a dApp
 */
export interface GrantedCapabilities {
  /** Origin URL of the dApp */
  origin: string;

  /** Display name of the dApp */
  appName: string;

  /** Icon URL for the dApp (optional) */
  appIcon?: string;

  /** Capabilities that have been granted */
  capabilities: WalletCapability[];

  /** Timestamp when capabilities were granted */
  grantedAt: number;

  /** Optional expiration timestamp */
  expiresAt?: number;

  /** Timestamp when capabilities were last used */
  lastUsed?: number;
}

/**
 * Interface for managing wallet permissions
 */
export interface PermissionManager {
  /**
   * Request capabilities from the user
   * @param request - The capability request
   * @returns Granted capabilities if approved, null if denied
   */
  requestCapabilities(request: CapabilityRequest): Promise<GrantedCapabilities | null>;

  /**
   * Check if a dApp has a specific capability
   * @param origin - Origin URL of the dApp
   * @param capability - The capability to check
   * @returns true if the capability is granted
   */
  hasCapability(origin: string, capability: WalletCapability): boolean;

  /**
   * Get all capabilities granted to a dApp
   * @param origin - Origin URL of the dApp
   * @returns Array of granted capabilities
   */
  getCapabilities(origin: string): WalletCapability[];

  /**
   * Revoke capabilities from a dApp
   * @param origin - Origin URL of the dApp
   * @param capabilities - Specific capabilities to revoke (all if not specified)
   */
  revokeCapabilities(origin: string, capabilities?: WalletCapability[]): void;

  /**
   * Get all dApps with their granted capabilities
   * @returns Array of all granted capability records
   */
  getAllGrantedCapabilities(): GrantedCapabilities[];

  /**
   * Update the last used timestamp for a dApp
   * @param origin - Origin URL of the dApp
   */
  updateLastUsed(origin: string): void;
}

/**
 * Check if a capability is valid
 */
export function isValidCapability(capability: string): capability is WalletCapability {
  return ALL_CAPABILITIES.includes(capability as WalletCapability);
}

/**
 * Filter an array to only valid capabilities
 */
export function filterValidCapabilities(capabilities: string[]): WalletCapability[] {
  return capabilities.filter(isValidCapability) as WalletCapability[];
}
