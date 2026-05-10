// Public entrypoint — hosts should import from here.
//
//    import { resolveOnsName, lookupOnsName, useOnsResolver, configureOns }
//      from '@/integrations/ons'

export {
  configureOns,
  getOnsConfig,
  resetOnsConfig,
  makeOnsConfig,
  type OnsConfig,
  type OnsNetwork,
} from './config'

export {
  createOnsClient,
  resolveOnsName,
  lookupOnsName,
  reverseOnsLookup,
  clearOnsCache,
  isOctAddress,
  isValidLabel,
  normalizeLabel,
  type OnsClient,
  type OnsRecord,
  type ResolveState,
} from './client'

export {
  useOnsResolver,
  type UseOnsResolverOptions,
  type UseOnsResolverResult,
} from './react'
