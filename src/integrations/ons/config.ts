// Network defaults + runtime configuration for the ONS resolver.
//
// Hosts customize this via `configureOns({ ... })` or by constructing a
// scoped client via `createOnsClient({ ... })`.

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
  devnet:  'http://165.227.225.79:8080',
  mainnet: 'https://rpc.octra.network',
}

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
