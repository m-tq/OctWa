// Network defaults + runtime configuration for the ONS resolver.
//
// Hosts customize this via `configureOns({ ... })` or by constructing a
// scoped client via `createOnsClient({ ... })`.

import {
  DEFAULT_OCTRA_MAINNET_URL,
  DEFAULT_OCTRA_DEVNET_URL,
} from '../../utils/rpcDefaults'

export type OnsNetwork = 'devnet' | 'mainnet'

export interface OnsConfig {
  network:    OnsNetwork
  contract:   string
  rpcUrl:     string
  cacheTtlMs: number
  /** Millis before a single view call is aborted. */
  requestTimeoutMs: number
}

const DEFAULT_CONTRACT: Record<OnsNetwork, string> = {
  devnet:  '',
  mainnet: '',
}

const DEFAULT_RPC: Record<OnsNetwork, string> = {
  devnet:  DEFAULT_OCTRA_DEVNET_URL,
  // Mainnet ONS lookups historically use the public proxy host since some
  // ONS clients run from contexts (e.g. content scripts) where direct IP
  // access is blocked. If you want all ONS traffic to follow the wallet's
  // configured RPC, swap this to DEFAULT_OCTRA_MAINNET_URL.
  mainnet: 'https://rpc.octra.network',
}

// Re-export so consumers can pick up the configured mainnet URL too.
export const ONS_MAINNET_DIRECT_URL = DEFAULT_OCTRA_MAINNET_URL

const DEFAULT_CONFIG: OnsConfig = {
  network:          'devnet',
  contract:         DEFAULT_CONTRACT.devnet,
  rpcUrl:           DEFAULT_RPC.devnet,
  cacheTtlMs:       15_000,
  requestTimeoutMs: 10_000,
}

let runtime: OnsConfig = { ...DEFAULT_CONFIG }

export function configureOns(patch: Partial<OnsConfig>): OnsConfig {
  const next: OnsConfig = { ...runtime, ...patch }

  // If a network is supplied without an explicit contract or rpc, fall back
  // to the network's default.
  if (patch.network) {
    if (!patch.contract) next.contract = DEFAULT_CONTRACT[patch.network] || runtime.contract
    if (!patch.rpcUrl)   next.rpcUrl   = DEFAULT_RPC[patch.network]      || runtime.rpcUrl
  }

  runtime = next
  return runtime
}

export function getOnsConfig(): OnsConfig {
  return runtime
}

export function resetOnsConfig(): void {
  runtime = { ...DEFAULT_CONFIG }
}

/**
 * Build a fresh config without mutating the global runtime. Useful for apps
 * that resolve across multiple networks concurrently (e.g. a block explorer
 * showing both devnet and mainnet panes).
 */
export function makeOnsConfig(patch: Partial<OnsConfig> = {}): OnsConfig {
  const network = patch.network ?? DEFAULT_CONFIG.network
  return {
    ...DEFAULT_CONFIG,
    network,
    contract: patch.contract ?? DEFAULT_CONTRACT[network] ?? DEFAULT_CONFIG.contract,
    rpcUrl:   patch.rpcUrl   ?? DEFAULT_RPC[network]      ?? DEFAULT_CONFIG.rpcUrl,
    cacheTtlMs:       patch.cacheTtlMs       ?? DEFAULT_CONFIG.cacheTtlMs,
    requestTimeoutMs: patch.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs,
  }
}
