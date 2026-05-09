/**
 * SDK × Octra RPC integration harness.
 *
 * Read-only. Verifies that:
 *   - The configured RPC is reachable
 *   - node_status / epoch_current / octra_recommendedFee resolve to usable values
 *   - The SDK's canonical serialization matches extensionFiles/core.js byte-for-byte
 *
 * Never submits a transaction. Safe to run against mainnet.
 *
 * Usage: `npx tsx tests/harness/cli.ts`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  canonicalizeCapability,
  canonicalizeInvocation,
  hashCapabilityWithDomain,
  hashInvocationWithDomain,
  OCTRA_CAPABILITY_PREFIX,
  OCTRA_INVOCATION_PREFIX,
} from '../../src/canonical';

// -------------------------------------------------------------------------
// Config
// -------------------------------------------------------------------------

const RPC_URL = (process.env.OCTRA_RPC_URL ?? 'http://46.101.86.250:8080').replace(/\/+$/, '');
const RPC_ENDPOINT = RPC_URL.endsWith('/rpc') ? RPC_URL : `${RPC_URL}/rpc`;

// -------------------------------------------------------------------------
// Utilities
// -------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function log(ok: boolean, label: string, detail?: string): void {
  const tag = ok ? 'PASS' : 'FAIL';
  // eslint-disable-next-line no-console
  console.log(`${tag.padEnd(4)}  ${label}${detail ? '  -- ' + detail : ''}`);
  if (ok) passCount += 1; else failCount += 1;
}

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T | null> {
  const resp = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!resp.ok) return null;
  const json = (await resp.json()) as { result?: T; error?: unknown };
  if (json.error) return null;
  return json.result ?? null;
}

// -------------------------------------------------------------------------
// Extension core loader (shared with parity test)
// -------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadExtensionCore(): any {
  const here     = dirname(fileURLToPath(import.meta.url));
  const corePath = resolve(here, '..', '..', '..', 'extensionFiles', 'core.js');
  const src      = readFileSync(corePath, 'utf8');
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('module', 'exports', 'crypto', 'TextEncoder', src);
  fn(mod, mod.exports, globalThis.crypto, globalThis.TextEncoder);
  return mod.exports;
}

// -------------------------------------------------------------------------
// Checks
// -------------------------------------------------------------------------

async function checkRpcConnectivity(): Promise<void> {
  try {
    const status = await rpc<{ network_version?: string; epoch_id?: number }>('node_status');
    log(!!status, 'RPC reachable', status ? `version=${status.network_version ?? '?'}` : RPC_ENDPOINT);
  } catch (err) {
    log(false, 'RPC reachable', (err as Error).message);
  }
}

async function checkEpoch(): Promise<void> {
  try {
    const r = await rpc<{ epoch_id?: number }>('epoch_current');
    const epoch = r?.epoch_id;
    log(typeof epoch === 'number' && epoch >= 0, 'epoch_current returns a number', `epoch=${epoch}`);
  } catch (err) {
    log(false, 'epoch_current', (err as Error).message);
  }
}

async function checkRecommendedFee(): Promise<void> {
  try {
    const r = await rpc<{ recommended?: string | number; base?: string | number }>(
      'octra_recommendedFee',
      ['standard'],
    );
    const rec = r?.recommended ?? r?.base;
    log(rec !== undefined && rec !== null, 'octra_recommendedFee(standard)', `recommended=${rec}`);
  } catch (err) {
    log(false, 'octra_recommendedFee', (err as Error).message);
  }
}

async function checkCanonicalParity(): Promise<void> {
  const ext = loadExtensionCore();

  // Confirm required exports exist
  const requiredExt = [
    'canonicalize',
    'canonicalizeCapability',
    'canonicalizeInvocation',
    'hashCapabilityWithDomain',
    'hashInvocationWithDomain',
    'OCTRA_CAPABILITY_PREFIX',
    'OCTRA_INVOCATION_PREFIX',
  ];
  for (const k of requiredExt) {
    log(k in ext, `extension core.js exports '${k}'`);
  }

  log(ext.OCTRA_CAPABILITY_PREFIX === OCTRA_CAPABILITY_PREFIX,
    `capability prefix matches SDK`,
    `ext=${ext.OCTRA_CAPABILITY_PREFIX} sdk=${OCTRA_CAPABILITY_PREFIX}`);

  log(ext.OCTRA_INVOCATION_PREFIX === OCTRA_INVOCATION_PREFIX,
    `invocation prefix matches SDK`,
    `ext=${ext.OCTRA_INVOCATION_PREFIX} sdk=${OCTRA_INVOCATION_PREFIX}`);

  const cap = {
    version:   2,
    circle:    'harness_v1',
    methods:   ['delta', 'alpha', 'charlie'],   // intentionally unsorted
    scope:     'compute',
    encrypted: true,
    appOrigin: 'https://harness.local',
    branchId:  'main',
    epoch:     1234,
    issuedAt:  1_700_000_000_000,
    expiresAt: 1_700_003_600_000,
    nonceBase: 0,
  };
  const sdkCap = canonicalizeCapability(cap);
  const extCap = ext.canonicalizeCapability(cap);
  log(sdkCap === extCap, 'canonicalizeCapability SDK == extension');

  const sdkCapHash = await hashCapabilityWithDomain(cap);
  const extCapHash = await ext.hashCapabilityWithDomain(cap);
  log(sdkCapHash === extCapHash, 'hashCapabilityWithDomain SDK == extension', sdkCapHash);

  const inv = {
    header: {
      version:    2,
      circleId:   'harness_v1',
      branchId:   'main',
      epoch:      1234,
      nonce:      42,
      timestamp:  1_700_000_000_000,
      originHash: '0'.repeat(64),
    },
    body: {
      capabilityId: 'cap_test',
      method:       'alpha',
      payloadHash:  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
  };
  const sdkInv = canonicalizeInvocation(inv);
  const extInv = ext.canonicalizeInvocation(inv);
  log(sdkInv === extInv, 'canonicalizeInvocation SDK == extension');

  const sdkInvHash = await hashInvocationWithDomain(inv);
  const extInvHash = await ext.hashInvocationWithDomain(inv);
  log(sdkInvHash === extInvHash, 'hashInvocationWithDomain SDK == extension', sdkInvHash);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`OctWa SDK integration harness`);
  // eslint-disable-next-line no-console
  console.log(`RPC: ${RPC_ENDPOINT}\n`);

  await checkRpcConnectivity();
  await checkEpoch();
  await checkRecommendedFee();
  await checkCanonicalParity();

  // eslint-disable-next-line no-console
  console.log(`\nsummary: ${passCount} passed, ${failCount} failed`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('harness crashed:', err);
  process.exit(1);
});
