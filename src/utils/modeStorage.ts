// Persists and resolves the wallet operation mode (public/private) with privacy-first fallback.

export type OperationMode = 'public' | 'private';

const OPERATION_MODE_KEY = 'walletOperationMode';

export function saveOperationMode(mode: OperationMode): void {
  try {
    localStorage.setItem(OPERATION_MODE_KEY, mode);
  } catch (error) {
    console.error('Failed to save operation mode:', error);
  }
}

export function loadOperationMode(
  encryptedBalance: number,
  pendingTransfersCount = 0,
  cipher?: string,
): OperationMode {
  try {
    const stored = localStorage.getItem(OPERATION_MODE_KEY) as OperationMode | null;
    const privateAvailable = isPrivateModeAvailable(encryptedBalance, pendingTransfersCount, cipher);

    if (!stored) return privateAvailable ? 'private' : 'public';
    if (stored !== 'public' && stored !== 'private') return 'private';
    if (stored === 'private' && !privateAvailable) return 'public';

    return stored;
  } catch (error) {
    console.error('Failed to load operation mode:', error);
    return 'private';
  }
}

export function isPrivateModeAvailable(
  encryptedBalance: number,
  pendingTransfersCount = 0,
  cipher?: string,
): boolean {
  const hasValidCipher = !!cipher && cipher !== '0' && cipher.startsWith('hfhe_v1|');
  return encryptedBalance > 0 || hasValidCipher || pendingTransfersCount > 0;
}
