import type { ErrorCode } from './types';

/**
 * Base error class for all SDK errors
 */
export class OctraError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'OctraError';
    this.code = code;
    this.details = details;

    // V8 stack trace capture (Node.js, Chrome)
    const ErrorWithCapture = Error as typeof Error & { captureStackTrace?: (target: object, constructor: Function) => void };
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when the Octra Wallet extension is not installed
 */
export class NotInstalledError extends OctraError {
  constructor(details?: unknown) {
    super('NOT_INSTALLED', 'Octra Wallet extension is not installed', details);
    this.name = 'NotInstalledError';
  }
}

/**
 * Thrown when attempting operations that require connection
 */
export class NotConnectedError extends OctraError {
  constructor(details?: unknown) {
    super('NOT_CONNECTED', 'Not connected to a Circle', details);
    this.name = 'NotConnectedError';
  }
}

/**
 * Thrown when the user rejects a request
 */
export class UserRejectedError extends OctraError {
  constructor(message = 'User rejected the request', details?: unknown) {
    super('USER_REJECTED', message, details);
    this.name = 'UserRejectedError';
  }
}

/**
 * Thrown when an operation times out
 */
export class TimeoutError extends OctraError {
  constructor(operation = 'Operation', details?: unknown) {
    super('TIMEOUT', `${operation} timed out`, details);
    this.name = 'TimeoutError';
  }
}

/**
 * Thrown when input validation fails
 */
export class ValidationError extends OctraError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when capability validation fails (expired, invalid, not found)
 */
export class CapabilityError extends OctraError {
  constructor(message: string, details?: unknown) {
    super('CAPABILITY_ERROR', message, details);
    this.name = 'CapabilityError';
  }
}

/**
 * Thrown when method is not in capability's allowed scope
 */
export class ScopeViolationError extends OctraError {
  constructor(method: string, capabilityId: string, details?: unknown) {
    super(
      'SCOPE_VIOLATION',
      `Method '${method}' is not allowed by capability '${capabilityId}'`,
      details
    );
    this.name = 'ScopeViolationError';
  }
}

/**
 * Thrown when capability signature verification fails
 */
export class SignatureInvalidError extends OctraError {
  constructor(capabilityId: string, details?: unknown) {
    super(
      'SIGNATURE_INVALID',
      `Capability '${capabilityId}' has invalid signature`,
      details
    );
    this.name = 'SignatureInvalidError';
  }
}

/**
 * Thrown when capability has expired
 */
export class CapabilityExpiredError extends OctraError {
  constructor(capabilityId: string, expiresAt: number, details?: unknown) {
    super(
      'CAPABILITY_EXPIRED',
      `Capability '${capabilityId}' expired at ${new Date(expiresAt).toISOString()}`,
      details
    );
    this.name = 'CapabilityExpiredError';
  }
}

/**
 * Thrown when capability origin doesn't match current origin
 */
export class OriginMismatchError extends OctraError {
  constructor(expected: string, actual: string, details?: unknown) {
    super(
      'ORIGIN_MISMATCH',
      `Origin mismatch: capability bound to '${expected}', current origin is '${actual}'`,
      details
    );
    this.name = 'OriginMismatchError';
  }
}

/**
 * Check if an error is a user rejection error from the provider
 */
export function isUserRejectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('user rejected') ||
      message.includes('user denied') ||
      message.includes('rejected by user')
    );
  }
  return false;
}

/**
 * Wrap provider errors into appropriate SDK error types
 */
export function wrapProviderError(error: unknown): OctraError {
  if (error instanceof OctraError) {
    return error;
  }

  if (isUserRejectionError(error)) {
    return new UserRejectedError(
      error instanceof Error ? error.message : 'User rejected the request',
      error
    );
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes('timeout')) {
      return new TimeoutError('Request', error);
    }

    if (error.message.toLowerCase().includes('capability')) {
      return new CapabilityError(error.message, error);
    }

    if (error.message.toLowerCase().includes('signature')) {
      return new ValidationError(error.message, error);
    }

    if (error.message.toLowerCase().includes('origin')) {
      return new ValidationError(error.message, error);
    }

    return new ValidationError(error.message, error);
  }

  return new ValidationError('Unknown error occurred', error);
}
