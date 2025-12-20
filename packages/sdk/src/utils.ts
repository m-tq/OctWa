import type { OctraProvider } from './types';

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
    return provider;
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
 * @param timeout - Maximum time to wait in milliseconds
 * @returns Promise that resolves with provider or null
 */
export function detectProvider(timeout = DEFAULT_DETECTION_TIMEOUT): Promise<OctraProvider | null> {
  return new Promise((resolve) => {
    // Check if already available
    const existing = getProvider();
    if (existing) {
      resolve(existing);
      return;
    }
    
    // If no window (SSR), resolve immediately with null
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }
    
    let resolved = false;
    
    // Listen for the octraLoaded event
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
    
    // Also poll in case event was missed
    const pollInterval = setInterval(() => {
      if (resolved) return;
      const provider = getProvider();
      if (provider) {
        resolved = true;
        cleanup();
        resolve(provider);
      }
    }, POLLING_INTERVAL);
    
    // Timeout handler
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(null);
    }, timeout);
    
    // Cleanup function
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
 * Validate that a value is a valid amount (positive number or numeric string)
 */
export function isValidAmount(value: unknown): boolean {
  if (typeof value === 'number') {
    return !isNaN(value) && value >= 0;
  }
  if (typeof value === 'string') {
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
  }
  return false;
}

/**
 * Convert amount to string format
 */
export function normalizeAmount(amount: string | number): string {
  return String(amount);
}
