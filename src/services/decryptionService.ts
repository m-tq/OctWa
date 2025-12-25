/**
 * Decryption Service - Handles decryption of encrypted values with user consent
 * 
 * Requirements: 4.3, 4.4
 */

import {
  EncryptedValue,
  DecryptionRequest,
  DecryptionResult,
} from '../types/encrypted';
import { decryptClientBalance } from '../utils/crypto';

/**
 * Decrypt an encrypted value with user consent
 * Returns a DecryptionResult indicating success or failure
 * 
 * IMPORTANT: This function requires explicit user consent before proceeding
 */
export async function decrypt(request: DecryptionRequest): Promise<DecryptionResult> {
  // Requirement 4.4: Require explicit user consent before proceeding
  if (!request.userConsent) {
    return {
      success: false,
      error: 'User consent is required for decryption',
    };
  }

  // Already decrypted
  if (request.value.isDecrypted && request.value.decryptedValue !== undefined) {
    return {
      success: true,
      value: request.value.decryptedValue,
    };
  }

  // Cannot decrypt without the blob
  if (!request.value.blob || request.value.blob.length === 0) {
    return {
      success: false,
      error: 'No encrypted data to decrypt',
    };
  }

  return {
    success: false,
    error: 'Decryption requires a private key - use decryptWithKey instead',
  };
}

/**
 * Decrypt an encrypted value with a private key and user consent
 */
export async function decryptWithKey(
  request: DecryptionRequest,
  privateKeyBase64: string
): Promise<DecryptionResult> {
  // Requirement 4.4: Require explicit user consent before proceeding
  if (!request.userConsent) {
    return {
      success: false,
      error: 'User consent is required for decryption',
    };
  }

  // Already decrypted
  if (request.value.isDecrypted && request.value.decryptedValue !== undefined) {
    return {
      success: true,
      value: request.value.decryptedValue,
    };
  }

  // Cannot decrypt without the blob
  if (!request.value.blob || request.value.blob.length === 0) {
    return {
      success: false,
      error: 'No encrypted data to decrypt',
    };
  }

  try {
    // Convert blob to the format expected by decryptClientBalance
    const encryptedString = blobToEncryptedString(request.value.blob);
    
    // Use existing crypto utility for decryption
    const decryptedValue = await decryptClientBalance(encryptedString, privateKeyBase64);

    // Update the encrypted value in place
    request.value.isDecrypted = true;
    request.value.decryptedValue = decryptedValue;

    return {
      success: true,
      value: decryptedValue,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
    };
  }
}

/**
 * Convert a Uint8Array blob to the encrypted string format used by the crypto utilities
 */
function blobToEncryptedString(blob: Uint8Array): string {
  // The blob is stored as raw bytes, convert to base64 with v2 prefix
  const base64 = Buffer.from(blob).toString('base64');
  return `v2|${base64}`;
}

/**
 * Decrypt a balance value with user consent
 * Convenience function for balance-specific decryption
 */
export async function decryptBalance(
  encryptedValue: EncryptedValue,
  privateKeyBase64: string,
  userConsent: boolean
): Promise<DecryptionResult> {
  return decryptWithKey(
    { value: encryptedValue, userConsent },
    privateKeyBase64
  );
}

/**
 * Check if decryption is allowed (user has given consent)
 */
export function isDecryptionAllowed(userConsent: boolean): boolean {
  return userConsent === true;
}
