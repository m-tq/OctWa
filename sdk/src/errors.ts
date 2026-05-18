/**
 * @octwa/sdk — Error Classes (RFC-O-1 Compliant)
 *
 * Standard error codes:
 *   4001 — User rejected
 *   4100 — Unauthorized
 *   4200 — Unsupported method
 *   4900 — Disconnected
 *   4901 — Network unavailable
 */

import { OctraErrorCode } from './types';
import type { OctraErrorReason } from './types';

export class OctraProviderError extends Error {
  readonly code: number;
  readonly data?: { reason?: OctraErrorReason; [key: string]: unknown };

  constructor(code: number, message: string, reason?: OctraErrorReason) {
    super(message);
    this.name = 'OctraProviderError';
    this.code = code;
    this.data = reason ? { reason } : undefined;
  }
}

export class UserRejectedError extends OctraProviderError {
  constructor(message = 'User rejected the request') {
    super(OctraErrorCode.UserRejected, message);
    this.name = 'UserRejectedError';
  }
}

export class UnauthorizedError extends OctraProviderError {
  constructor(message = 'Unauthorized', reason?: OctraErrorReason) {
    super(OctraErrorCode.Unauthorized, message, reason);
    this.name = 'UnauthorizedError';
  }
}

export class UnsupportedMethodError extends OctraProviderError {
  constructor(method: string) {
    super(OctraErrorCode.UnsupportedMethod, `Unsupported method: ${method}`);
    this.name = 'UnsupportedMethodError';
  }
}

export class DisconnectedError extends OctraProviderError {
  constructor(message = 'Provider is disconnected from all Octra networks') {
    super(OctraErrorCode.Disconnected, message);
    this.name = 'DisconnectedError';
  }
}

export class NetworkUnavailableError extends OctraProviderError {
  constructor(networkId?: string) {
    super(
      OctraErrorCode.NetworkUnavailable,
      networkId
        ? `Cannot service network: ${networkId}`
        : 'Requested network is unavailable',
    );
    this.name = 'NetworkUnavailableError';
  }
}

export class NotInstalledError extends OctraProviderError {
  constructor() {
    super(OctraErrorCode.Disconnected, 'Octra Wallet extension is not installed');
    this.name = 'NotInstalledError';
  }
}

export class TimeoutError extends OctraProviderError {
  constructor(operation = 'Operation') {
    super(OctraErrorCode.Disconnected, `${operation} timed out`);
    this.name = 'TimeoutError';
  }
}

/**
 * Check if an error is a user rejection (code 4001).
 */
export function isUserRejection(error: unknown): boolean {
  if (error instanceof OctraProviderError) return error.code === OctraErrorCode.UserRejected;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('user rejected') || msg.includes('user denied');
  }
  return false;
}

/**
 * Wrap a raw provider error into a typed OctraProviderError.
 *
 * Maps each RFC-O-1 standard code onto its dedicated subclass so
 * downstream code can do `err instanceof UnauthorizedError` rather
 * than checking `.code` manually. Falls back to the base class only
 * for non-standard codes.
 */
export function wrapProviderError(error: unknown): OctraProviderError {
  if (error instanceof OctraProviderError) return error;

  if (error && typeof error === 'object' && 'code' in error) {
    const e = error as { code: number; message?: string; data?: { reason?: OctraErrorReason } };
    const message = e.message || 'Unknown error';
    const reason = e.data?.reason;
    switch (e.code) {
      case OctraErrorCode.UserRejected:        return new UserRejectedError(message);
      case OctraErrorCode.Unauthorized:        return new UnauthorizedError(message, reason);
      case OctraErrorCode.UnsupportedMethod:   return new UnsupportedMethodError(extractMethod(message));
      case OctraErrorCode.Disconnected:        return new DisconnectedError(message);
      case OctraErrorCode.NetworkUnavailable:  return new NetworkUnavailableError(extractNetworkId(message));
      default:                                 return new OctraProviderError(e.code, message, reason);
    }
  }

  if (error instanceof Error) {
    if (isUserRejection(error)) return new UserRejectedError(error.message);
    if (error.message.toLowerCase().includes('timeout')) return new TimeoutError();
    return new OctraProviderError(OctraErrorCode.Unauthorized, error.message);
  }

  return new OctraProviderError(OctraErrorCode.Unauthorized, 'Unknown error');
}

/** Extract the method name from a `Unsupported method: <name>` style message. */
function extractMethod(message: string): string {
  const m = message.match(/method:\s*([\w_]+)/i);
  return m ? m[1] : message;
}

/** Extract the network id from a `Network unavailable: <id>` style message. */
function extractNetworkId(message: string): string | undefined {
  const m = message.match(/network[^:]*:\s*([\w:.\-]+)/i);
  return m ? m[1] : undefined;
}
