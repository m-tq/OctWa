import type { OctraProvider, CapabilityScope } from './types';

const DEFAULT_DETECTION_TIMEOUT = 3000;
const POLLING_INTERVAL = 100;

/**
 * Get the Octra provider from window if available.
 */
export function getProvider(): OctraProvider | null {
  if (typeof window === 'undefined') return null;
  const p = window.octra;
  return p && p.isOctra === true ? p : null;
}

/** Synchronous check — is the provider installed? */
export function isProviderInstalled(): boolean {
  return getProvider() !== null;
}

/**
 * Wait for the provider to be injected into window.
 *
 * Listens for both legacy `octraLoaded` event and the new
 * `octra:announceProvider` CustomEvent (EIP-6963 analog).
 * Falls back to polling every 100 ms until timeout.
 */
export function detectProvider(timeout = DEFAULT_DETECTION_TIMEOUT): Promise<OctraProvider | null> {
  return new Promise((resolve) => {
    const existing = getProvider();
    if (existing) { resolve(existing); return; }

    if (typeof window === 'undefined') { resolve(null); return; }

    let resolved = false;

    const tryResolve = () => {
      if (resolved) return;
      const p = getProvider();
      if (p) { resolved = true; cleanup(); resolve(p); }
    };

    // Legacy event
    window.addEventListener('octraLoaded', tryResolve);

    // EIP-6963 analog — octra:announceProvider
    const handleAnnounce = (e: Event) => {
      if (resolved) return;
      const detail = (e as CustomEvent).detail;
      if (detail?.provider?.isOctra) {
        resolved = true;
        cleanup();
        resolve(detail.provider as OctraProvider);
      }
    };
    window.addEventListener('octra:announceProvider', handleAnnounce);

    // Request any already-injected providers to re-announce
    window.dispatchEvent(new Event('octra:requestProvider'));

    const pollInterval = setInterval(tryResolve, POLLING_INTERVAL);

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(null);
    }, timeout);

    const cleanup = () => {
      window.removeEventListener('octraLoaded', tryResolve);
      window.removeEventListener('octra:announceProvider', handleAnnounce);
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  });
}

/** Validate that a value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validate that a scope is valid. */
export function isValidScope(scope: unknown): scope is CapabilityScope {
  return scope === 'read' || scope === 'write' || scope === 'compute';
}

/** Validate Circle ID format. */
export function isValidCircleId(circleId: unknown): circleId is string {
  return isNonEmptyString(circleId);
}

/** Check if a value is an EncryptedBlob. */
export function isEncryptedBlob(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const blob = value as Record<string, unknown>;
  return blob.scheme === 'HFHE' && blob.data instanceof Uint8Array;
}

/** Get current origin safely. */
export function getCurrentOrigin(): string {
  if (typeof window === 'undefined') return '';
  try { return window.location?.origin || ''; } catch { return ''; }
}
