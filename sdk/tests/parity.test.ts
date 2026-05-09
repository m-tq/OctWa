/**
 * Cross-implementation parity tests.
 *
 * The SDK's canonical serialization and hashing MUST produce
 * byte-identical output to the extension's `core.js`. If these
 * diverge, capability signatures issued by the wallet will fail
 * verification in the SDK and vice versa.
 *
 * This test imports the actual `extensionFiles/core.js` file
 * (which is CommonJS) and re-runs the same inputs against both.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  canonicalizeCapability as sdkCanonCap,
  canonicalizeInvocation as sdkCanonInvoke,
  hashCapabilityWithDomain as sdkHashCap,
  hashInvocationWithDomain as sdkHashInvoke,
  canonicalize as sdkCanonicalize,
} from '../src/canonical';
import { hashPayload } from '../src/canonical';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ext: any = null;

beforeAll(() => {
  // Load extensionFiles/core.js by reading the source and evaluating it
  // with a stub `module.exports` object. This avoids ESM/CJS resolution
  // issues between vitest and the extension's plain-JS file.
  try {
    const here      = dirname(fileURLToPath(import.meta.url));
    const corePath  = resolve(here, '..', '..', 'extensionFiles', 'core.js');
    const src       = readFileSync(corePath, 'utf8');
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function('module', 'exports', 'crypto', 'TextEncoder', src);
    fn(mod, mod.exports, globalThis.crypto, globalThis.TextEncoder);
    ext = mod.exports;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[parity] failed to load extensionFiles/core.js:', e);
    ext = null;
  }
});

const CAPABILITY = {
  version:   2,
  circle:    'analytics_v1',
  methods:   ['submit_input', 'read_stats'],
  scope:     'compute',
  encrypted: true,
  appOrigin: 'https://sample.app',
  branchId:  'main',
  epoch:     42,
  issuedAt:  1_735_686_000_000,
  expiresAt: 1_735_689_600_000,
  nonceBase: 0,
};

const INVOCATION = {
  header: {
    version:    2,
    circleId:   'analytics_v1',
    branchId:   'main',
    epoch:      42,
    nonce:      7,
    timestamp:  1_735_686_000_000,
    originHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  },
  body: {
    capabilityId: 'cap_test',
    method:       'submit_input',
    payloadHash:  'deadbeef'.repeat(8),
  },
};

describe('SDK <-> Extension canonical parity', () => {
  it('loads the extension core.js module', () => {
    expect(ext).not.toBeNull();
    expect(typeof ext.canonicalize).toBe('function');
    expect(typeof ext.canonicalizeCapability).toBe('function');
    expect(typeof ext.canonicalizeInvocation).toBe('function');
    expect(typeof ext.hashCapabilityWithDomain).toBe('function');
    expect(typeof ext.hashInvocationWithDomain).toBe('function');
  });

  it('canonicalize() matches for primitive types', () => {
    const cases: unknown[] = [
      null,
      true,
      false,
      0,
      -1,
      42,
      1.5,
      'hello',
      '"quoted"',
      [],
      [1, 2, 3],
      { a: 1, b: 2 },
      { b: 2, a: 1 },                   // key order must not matter
      { nested: { z: 1, a: 2 } },
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    ];
    for (const c of cases) {
      expect(sdkCanonicalize(c)).toBe(ext.canonicalize(c));
    }
  });

  it('canonicalizeCapability() produces identical output', () => {
    const a = sdkCanonCap(CAPABILITY);
    const b = ext.canonicalizeCapability(CAPABILITY);
    expect(a).toBe(b);
  });

  it('canonicalizeCapability() sorts methods deterministically', () => {
    const reordered = { ...CAPABILITY, methods: ['zzz', 'aaa', 'mmm'] };
    const a = sdkCanonCap(reordered);
    const b = ext.canonicalizeCapability(reordered);
    expect(a).toBe(b);
    expect(a.includes('["aaa","mmm","zzz"]')).toBe(true);
  });

  it('canonicalizeInvocation() produces identical output', () => {
    const a = sdkCanonInvoke(INVOCATION);
    const b = ext.canonicalizeInvocation(INVOCATION);
    expect(a).toBe(b);
  });

  it('hashCapabilityWithDomain() produces identical digests', async () => {
    const a = await sdkHashCap(CAPABILITY);
    const b = await ext.hashCapabilityWithDomain(CAPABILITY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashInvocationWithDomain() produces identical digests', async () => {
    const a = await sdkHashInvoke(INVOCATION);
    const b = await ext.hashInvocationWithDomain(INVOCATION);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('domain prefixes are identical across SDK and extension', () => {
    expect(ext.OCTRA_CAPABILITY_PREFIX).toBe('OctraCapability:v2:');
    expect(ext.OCTRA_INVOCATION_PREFIX).toBe('OctraInvocation:v2:');
  });
});

describe('hashPayload is real SHA-256', () => {
  it('produces 64-char lowercase hex for arbitrary payloads', async () => {
    const out = await hashPayload(new Uint8Array([1, 2, 3, 4]));
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the known SHA-256 digest for an empty buffer', async () => {
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const out = await hashPayload(new Uint8Array([]));
    expect(out).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces the known SHA-256 digest for ASCII "abc"', async () => {
    // SHA-256('abc') = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const out = await hashPayload(new TextEncoder().encode('abc'));
    expect(out).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('changes when payload changes', async () => {
    const a = await hashPayload(new Uint8Array([1, 2, 3]));
    const b = await hashPayload(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });
});
