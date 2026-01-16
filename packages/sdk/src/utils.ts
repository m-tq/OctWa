import type { OctraProvider, CapabilityScope } from './types';

const DEFAULT_DETECTION_TIMEOUT = 3000;
const POLLING_INTERVAL = 100;

/**
 * Check if the Octra provider is available in window
 */
export function getProvider(): OctraProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const provider = window.octra;
  if (provider && provider.isOctra === true) {
    return provider as OctraProvider;
  }

  return null;
}

/**
 * Check if provider is installed (synchronous check)
 */
export function isProviderInstalled(): boolean {
  return getProvider() !== null;
}

/**
 * Wait for the provider to be injected into window
 */
export function detectProvider(timeout = DEFAULT_DETECTION_TIMEOUT): Promise<OctraProvider | null> {
  return new Promise((resolve) => {
    const existing = getProvider();
    if (existing) {
      resolve(existing);
      return;
    }

    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }

    let resolved = false;

    const handleLoaded = () => {
      if (resolved) return;
      const provider = getProvider();
      if (provider) {
        resolved = true;
        cleanup();
        resolve(provider);
      }
    };

    window.addEventListener('octraLoaded', handleLoaded);

    const pollInterval = setInterval(() => {
      if (resolved) return;
      const provider = getProvider();
      if (provider) {
        resolved = true;
        cleanup();
        resolve(provider);
      }
    }, POLLING_INTERVAL);

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(null);
    }, timeout);

    const cleanup = () => {
      window.removeEventListener('octraLoaded', handleLoaded);
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  });
}

/**
 * Validate that a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that a scope is valid
 */
export function isValidScope(scope: unknown): scope is CapabilityScope {
  return scope === 'read' || scope === 'write' || scope === 'compute';
}

/**
 * Validate Circle ID format
 */
export function isValidCircleId(circleId: unknown): circleId is string {
  return isNonEmptyString(circleId);
}

/**
 * Check if a value is an EncryptedBlob
 */
export function isEncryptedBlob(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const blob = value as Record<string, unknown>;
  return (
    blob.scheme === 'HFHE' &&
    blob.data instanceof Uint8Array
  );
}

/**
 * Get current origin safely
 */
export function getCurrentOrigin(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.location?.origin || '';
  } catch {
    return '';
  }
}
