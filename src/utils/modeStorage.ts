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
 * - If no mode is stored, defaults to 'public'
 * - If stored mode is 'private' but no encrypted balance and no pending transfers, falls back to 'public'
 * 
 * @param encryptedBalance - The current encrypted balance (used for fallback logic)
 * @param pendingTransfersCount - The number of pending unclaimed transfers (optional)
 * @returns The operation mode to use
 */
export function loadOperationMode(encryptedBalance: number, pendingTransfersCount: number = 0): OperationMode {
  try {
    const storedMode = localStorage.getItem(STORAGE_KEY) as OperationMode | null;
    
    // Default to 'public' if no mode is stored
    if (!storedMode) {
      return 'public';
    }
    
    // Validate stored mode
    if (storedMode !== 'public' && storedMode !== 'private') {
      return 'public';
    }
    
    // Fall back to 'public' if stored mode is 'private' but no encrypted balance and no pending transfers
    if (storedMode === 'private' && encryptedBalance <= 0 && pendingTransfersCount <= 0) {
      return 'public';
    }
    
    return storedMode;
  } catch (error) {
    console.error('Failed to load operation mode from localStorage:', error);
    return 'public';
  }
}

/**
 * Clears the stored operation mode from localStorage.
 */
export function clearOperationMode(): void {
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
 * @returns true if Private mode can be enabled
 */
export function isPrivateModeAvailable(encryptedBalance: number, pendingTransfersCount: number = 0): boolean {
  return encryptedBalance > 0 || pendingTransfersCount > 0;
}
