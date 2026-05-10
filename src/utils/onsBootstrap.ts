// Keeps the ONS resolver pointed at the wallet's active RPC provider.
//
// The ONS integration lives under `src/integrations/ons/` and is framework
// agnostic. This file is the wallet-specific adapter that reads the user's
// current RPC selection and pushes the right network + endpoint into the
// resolver config.

import { configureOns, clearOnsCache, type OnsNetwork } from '@/integrations/ons'

import { getActiveRPCProvider } from './rpc'
import { getActiveNetwork } from './explorer'

/**
 * Reads the ONS contract address for the given network from Vite env vars.
 *
 *   VITE_ONS_CONTRACT_DEVNET   — ONS contract address on devnet
 *   VITE_ONS_CONTRACT_MAINNET  — ONS contract address on mainnet
 *
 * Returns `undefined` when the env var is unset or blank, letting the
 * resolver fall back to its own defaults (which are empty strings for
 * networks that have no deployed contract yet).
 */
function pickContract(network: OnsNetwork): string | undefined {
  const fromEnv = network === 'devnet'
    ? import.meta.env.VITE_ONS_CONTRACT_DEVNET
    : import.meta.env.VITE_ONS_CONTRACT_MAINNET

  const trimmed = typeof fromEnv === 'string' ? fromEnv.trim() : ''
  return trimmed.length > 0 ? trimmed : undefined
}

export function syncOnsConfigFromActiveProvider(): void {
  const network = getActiveNetwork()
  const provider = getActiveRPCProvider()
  const contract = pickContract(network)

  configureOns({
    network,
    rpcUrl:   provider?.url,
    contract,
  })

  // Active provider changed → invalidate stale resolutions.
  clearOnsCache()
}
