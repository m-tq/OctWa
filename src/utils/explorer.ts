/**
 * Explorer URL utilities — network-aware.
 *
 * Mainnet: https://octrascan.io
 * Devnet:  https://devnet.octrascan.io
 */

import { getActiveRPCProvider } from './rpc'

const MAINNET_EXPLORER = 'https://octrascan.io'
const DEVNET_EXPLORER  = 'https://devnet.octrascan.io'

/** Detect active network from the RPC provider URL. */
export function getActiveNetwork(): 'mainnet' | 'devnet' {
  try {
    const provider = getActiveRPCProvider()
    if (!provider) return 'mainnet'
    const url = provider.url.toLowerCase()
    // Devnet node IP
    if (url.includes('165.227.225.79')) return 'devnet'
    if (url.includes('devnet')) return 'devnet'
    // Check by provider id or network field
    if ((provider as { network?: string }).network === 'devnet') return 'devnet'
    if ((provider as { id?: string }).id === 'devnet') return 'devnet'
  } catch { /* ignore */ }
  return 'mainnet'
}

/** Base explorer URL for the active network. */
export function getExplorerBase(): string {
  return getActiveNetwork() === 'devnet' ? DEVNET_EXPLORER : MAINNET_EXPLORER
}

/** Full URL to a transaction on the active network explorer. */
export function getTxExplorerUrl(txHash: string): string {
  return `${getExplorerBase()}/tx.html?hash=${txHash}`
}

/** Full URL to an address on the active network explorer. */
export function getAddressExplorerUrl(address: string): string {
  return `${getExplorerBase()}/address.html?addr=${address}`
}

/** Explorer name for display. */
export function getExplorerName(): string {
  return 'Octrascan'
}
