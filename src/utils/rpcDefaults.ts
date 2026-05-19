/**
 * Default Octra RPC endpoints — single source of truth.
 *
 * Sourced from `VITE_OCTRA_RPC_URL_MAINNET` / `VITE_OCTRA_RPC_URL_DEVNET`
 * in `.env`. Falls back to the publicly known Octra-labs nodes if those
 * env vars are absent so the wallet still boots in dev environments
 * without an `.env` file.
 *
 * Users override these at runtime via Settings → RPC Providers; the
 * overrides live in `localStorage` (chrome.storage.local in the extension
 * service worker). These constants are only used as the bootstrap defaults
 * before any user override exists.
 *
 * To rotate node addresses for the whole wallet, edit `.env` and rebuild;
 * no source-code changes required.
 */

export const DEFAULT_OCTRA_MAINNET_URL =
  (import.meta.env.VITE_OCTRA_RPC_URL_MAINNET as string | undefined) ||
  'http://46.101.86.250:8080';

export const DEFAULT_OCTRA_DEVNET_URL =
  (import.meta.env.VITE_OCTRA_RPC_URL_DEVNET as string | undefined) ||
  'http://165.227.225.79:8080';

/**
 * Hostnames used to recognise the official devnet RPC in places where we
 * need to classify a URL into a network bucket (explorer routing, dApp
 * network filtering). Add entries here when devnet IP rotates.
 */
export const DEVNET_HOST_HINTS: readonly string[] = [
  '165.227.225.79',
  // Legacy / aliases — anything that should still classify as devnet.
  'devnet.octrascan',
];

/**
 * Returns true if `url` looks like a devnet endpoint.
 *
 * Checks first against the env-configured devnet URL (so if devnet IP
 * changes, only `.env` needs updating), then against the static hints
 * above. Case-insensitive substring match.
 */
export function isDevnetUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (DEFAULT_OCTRA_DEVNET_URL && lower.includes(DEFAULT_OCTRA_DEVNET_URL.replace(/^https?:\/\//, '').toLowerCase())) {
    return true;
  }
  return DEVNET_HOST_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}
