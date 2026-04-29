/**
 * Mode Storage Utility
 * Handles persistence of operation mode (public/private) to localStorage
 * with fallback logic for when encrypted balance is depleted.
 */

export type OperationMode = 'public' | 'private';

const STORAGE_KEY = 'walletOperationMode';

/**
 * Saves the current operation mode to localStorage.
 * @param mode - The operation mode to save ('public' or 'private')
 */
export function saveOperationMode(mode: OperationMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (error) {
    console.error('Failed to save operation mode to localStorage:', error);
  }
}

/**
 * Loads the operation mode from localStorage with fallback logic.
 * - If no mode is stored, defaults to 'private' (privacy-first approach)
 * - If stored mode is 'private' but no encrypted balance and no pending transfers, falls back to 'public'
 * 
 * @param encryptedBalance - The current encrypted balance (used for fallback logic)
 * @param pendingTransfersCount - The number of pending unclaimed transfers (optional)
 * @param cipher - The encrypted balance cipher (optional, for checking if encrypted balance exists)
 * @returns The operation mode to use
 */
export function loadOperationMode(
  encryptedBalance: number, 
  pendingTransfersCount: number = 0,
  cipher?: string
): OperationMode {
  try {
    const storedMode = localStorage.getItem(STORAGE_KEY) as OperationMode | null;
    
    // Check if private mode is available
    const privateModeAvailable = isPrivateModeAvailable(encryptedBalance, pendingTransfersCount, cipher);
    
    // Default to 'private' if no mode is stored (privacy-first)
    if (!storedMode) {
      // But fall back to public if private mode is not available
      if (!privateModeAvailable) {
        return 'public';
      }
      return 'private';
    }
    
    // Validate stored mode
    if (storedMode !== 'public' && storedMode !== 'private') {
      return 'private';
    }
    
    // Fall back to 'public' if stored mode is 'private' but private mode is not available
    if (storedMode === 'private' && !privateModeAvailable) {
      return 'public';
    }
    
    return storedMode;
  } catch (error) {
    console.error('Failed to load operation mode from localStorage:', error);
    return 'private';
  }
}

/**
 * Clears the stored operation mode from localStorage.
 */
function clearOperationMode(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear operation mode from localStorage:', error);
  }
}

/**
 * Checks if Private mode should be enabled based on encrypted balance or pending transfers.
 * @param encryptedBalance - The current encrypted balance
 * @param pendingTransfersCount - The number of pending unclaimed transfers (optional)
 * @param cipher - The encrypted balance cipher (optional, for checking if encrypted balance exists)
 * @returns true if Private mode can be enabled
 */
export function isPrivateModeAvailable(
  encryptedBalance: number, 
  pendingTransfersCount: number = 0,
  cipher?: string
): boolean {
  // Check if there's a valid cipher (encrypted balance exists but not yet decrypted)
  const hasValidCipher = cipher && cipher !== '0' && cipher !== '' && cipher.startsWith('hfhe_v1|');
  
  // Private mode is available if:
  // 1. Encrypted balance > 0 (decrypted value available), OR
  // 2. Valid cipher exists (encrypted balance exists but not yet decrypted), OR
  // 3. Pending transfers > 0
  return encryptedBalance > 0 || hasValidCipher || pendingTransfersCount > 0;
}
