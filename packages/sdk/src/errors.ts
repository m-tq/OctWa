import type { ErrorCode } from './types';

export class OctraError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'OctraError';
    this.code = code;
    this.details = details;

    const ErrorWithCapture = Error as typeof Error & {
      captureStackTrace?: (target: object, constructor: Function) => void;
    };
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, this.constructor);
    }
  }
}

export class NotInstalledError extends OctraError {
  constructor(details?: unknown) {
    super('NOT_INSTALLED', 'Octra Wallet extension is not installed', details);
    this.name = 'NotInstalledError';
  }
}

export class NotConnectedError extends OctraError {
  constructor(details?: unknown) {
    super('NOT_CONNECTED', 'Not connected to a Circle', details);
    this.name = 'NotConnectedError';
  }
}

export class UserRejectedError extends OctraError {
  constructor(message = 'User rejected the request', details?: unknown) {
    super('USER_REJECTED', message, details);
    this.name = 'UserRejectedError';
  }
}

export class TimeoutError extends OctraError {
  constructor(operation = 'Operation', details?: unknown) {
    super('TIMEOUT', `${operation} timed out`, details);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends OctraError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class CapabilityError extends OctraError {
  constructor(message: string, details?: unknown) {
    super('CAPABILITY_ERROR', message, details);
    this.name = 'CapabilityError';
  }
}

export class ScopeViolationError extends OctraError {
  constructor(method: string, capabilityId: string, details?: unknown) {
    super('SCOPE_VIOLATION', `Method '${method}' is not allowed by capability '${capabilityId}'`, details);
    this.name = 'ScopeViolationError';
  }
}

export class SignatureInvalidError extends OctraError {
  constructor(capabilityId: string, details?: unknown) {
    super('SIGNATURE_INVALID', `Capability '${capabilityId}' has invalid signature`, details);
    this.name = 'SignatureInvalidError';
  }
}

export class CapabilityExpiredError extends OctraError {
  constructor(capabilityId: string, expiresAt: number, details?: unknown) {
    super(
      'CAPABILITY_EXPIRED',
      `Capability '${capabilityId}' expired at ${new Date(expiresAt).toISOString()}`,
      details,
    );
    this.name = 'CapabilityExpiredError';
  }
}

export class CapabilityRevokedError extends OctraError {
  constructor(capabilityId: string, details?: unknown) {
    super('CAPABILITY_REVOKED', `Capability '${capabilityId}' has been revoked`, details);
    this.name = 'CapabilityRevokedError';
  }
}

export class BranchMismatchError extends OctraError {
  constructor(expected: string, actual: string, details?: unknown) {
    super('BRANCH_MISMATCH', `Branch mismatch: expected '${expected}', got '${actual}'`, details);
    this.name = 'BranchMismatchError';
  }
}

export class EpochMismatchError extends OctraError {
  constructor(expected: number, actual: number, details?: unknown) {
    super('EPOCH_MISMATCH', `Epoch mismatch: expected ${expected}, got ${actual}`, details);
    this.name = 'EpochMismatchError';
  }
}

export class NonceViolationError extends OctraError {
  constructor(capabilityId: string, lastNonce: number, attemptedNonce: number, details?: unknown) {
    super(
      'NONCE_VIOLATION',
      `Nonce violation for capability '${capabilityId}': attempted ${attemptedNonce}, must be > ${lastNonce}`,
      details,
    );
    this.name = 'NonceViolationError';
  }
}

export class DomainSeparationError extends OctraError {
  constructor(message: string, details?: unknown) {
    super('DOMAIN_SEPARATION_ERROR', message, details);
    this.name = 'DomainSeparationError';
  }
}

export class OriginMismatchError extends OctraError {
  constructor(expected: string, actual: string, details?: unknown) {
    super(
      'ORIGIN_MISMATCH',
      `Origin mismatch: capability bound to '${expected}', current origin is '${actual}'`,
      details,
    );
    this.name = 'OriginMismatchError';
  }
}

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

export function wrapProviderError(error: unknown): OctraError {
  if (error instanceof OctraError) return error;
  if (isUserRejectionError(error)) {
    return new UserRejectedError(
      error instanceof Error ? error.message : 'User rejected the request',
      error,
    );
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout'))    return new TimeoutError('Request', error);
    if (msg.includes('capability')) return new CapabilityError(error.message, error);
    return new ValidationError(error.message, error);
  }

  return new ValidationError('Unknown error occurred', error);
}
