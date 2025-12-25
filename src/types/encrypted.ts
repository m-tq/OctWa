/**
 * Types for handling opaque encrypted data
 * Encrypted values are treated as opaque by default and require explicit user consent to decrypt
 */

/** Type hints for encrypted values */
export type EncryptedValueTypeHint = 'balance' | 'message' | 'contract_result' | 'unknown';

/**
 * Represents an opaque encrypted value
 * UI should display these as locked until explicitly decrypted
 */
export interface EncryptedValue {
  /** The encrypted data blob */
  blob: Uint8Array;

  /** Optional hint about the underlying data type */
  typeHint?: EncryptedValueTypeHint;

  /** Whether this value has been decrypted */
  isDecrypted: boolean;

  /** The decrypted value (only set after explicit decryption with user consent) */
  decryptedValue?: unknown;
}

/**
 * Request to decrypt an encrypted value
 * Requires explicit user consent
 */
export interface DecryptionRequest {
  /** The encrypted value to decrypt */
  value: EncryptedValue;

  /** User consent confirmation - must be true to proceed */
  userConsent: boolean;
}

/**
 * Result of a decryption operation
 */
export interface DecryptionResult {
  /** Whether decryption was successful */
  success: boolean;

  /** The decrypted value (if successful) */
  value?: unknown;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Encrypted balance data model
 * Supports both encrypted and plaintext values for backward compatibility
 */
export interface EncryptedBalanceData {
  /** Public balance (may be encrypted or plaintext) */
  public: EncryptedValue | number;

  /** Encrypted balance portion */
  encrypted: EncryptedValue | number;

  /** Total balance */
  total: EncryptedValue | number;
}

/**
 * Type guard to check if a value is an EncryptedValue
 */
export function isEncryptedValue(value: unknown): value is EncryptedValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    'blob' in obj &&
    obj.blob instanceof Uint8Array &&
    'isDecrypted' in obj &&
    typeof obj.isDecrypted === 'boolean'
  );
}

/**
 * Create a new EncryptedValue from raw encrypted data
 */
export function createEncryptedValue(
  blob: Uint8Array,
  typeHint?: EncryptedValueTypeHint
): EncryptedValue {
  return {
    blob,
    typeHint,
    isDecrypted: false,
  };
}

/**
 * Get display text for an encrypted or plaintext value
 * Returns the value if plaintext, or a locked indicator if encrypted
 */
export function getDisplayValue(
  value: EncryptedValue | number | string | unknown,
  lockedText: string = '🔒 Encrypted'
): string {
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isEncryptedValue(value)) {
    if (value.isDecrypted && value.decryptedValue !== undefined) {
      return String(value.decryptedValue);
    }
    return lockedText;
  }
  return lockedText;
}
