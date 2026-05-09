/**
 * Wire-format tests.
 *
 * Asserts that the payloads the SDK hands to the extension match the
 * Octra node's expected transaction shape (see `webcli/lib/tx_builder.hpp`
 * and `.kiro/steering/octra-workspace.md` section 4).
 *
 * We capture the raw invocation payload by intercepting the mock provider.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OctraSDK } from '../src/sdk';
import type { SignedInvocation } from '../src/types';
import { createMockProvider, injectMockProvider, clearMockProvider } from './mocks/provider';

function extractPayload(call: SignedInvocation): Record<string, unknown> | null {
  const payload = call.payload as { _type?: string; data?: number[] } | undefined;
  if (!payload || payload._type !== 'Uint8Array' || !Array.isArray(payload.data)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.data)));
  } catch {
    return null;
  }
}

describe('Wire format: sendContractCall', () => {
  beforeEach(() => clearMockProvider());
  afterEach(() => clearMockProvider());

  it('maps method -> encrypted_data, params -> message, and sets op_type=call', async () => {
    let captured: SignedInvocation | null = null;
    const provider = createMockProvider();
    const origInvoke = provider.invoke.bind(provider);
    provider.invoke = async (call: SignedInvocation) => {
      captured = call;
      const jsonResult = { txHash: '0x'.padEnd(66, 'a') };
      return {
        success: true,
        data:    new TextEncoder().encode(JSON.stringify(jsonResult)),
      };
    };
    injectMockProvider(provider);

    const sdk = await OctraSDK.init({ timeout: 100, skipSignatureVerification: true });
    await sdk.connect({ circle: 'test', appOrigin: 'https://example.com' });
    const cap = await sdk.requestCapability({
      circle: 'test',
      methods: ['send_transaction'],
      scope: 'write',
      encrypted: false,
    });

    await sdk.sendContractCall(cap.id, {
      contract: 'octCONTRACT',
      method:   'transfer',
      params:   ['octUSER', 1000],
      amount:   0,
      ou:       1000,
    });

    expect(captured).not.toBeNull();
    expect(captured!.body.method).toBe('send_transaction');

    const payload = extractPayload(captured!);
    expect(payload).not.toBeNull();
    expect(payload!.op_type).toBe('call');
    expect(payload!.to).toBe('octCONTRACT');
    expect(payload!.amount).toBe(0);
    expect(payload!.encrypted_data).toBe('transfer');
    expect(payload!.message).toBe('["octUSER",1000]');
    expect(payload!.ou).toBe(1000);
    void origInvoke;
  });
});

describe('Wire format: stealth send', () => {
  beforeEach(() => clearMockProvider());
  afterEach(() => clearMockProvider());

  it('passes { to, amount } verbatim through the stealth_send method', async () => {
    let captured: SignedInvocation | null = null;
    const provider = createMockProvider();
    provider.invoke = async (call: SignedInvocation) => {
      captured = call;
      return {
        success: true,
        data:    new TextEncoder().encode(JSON.stringify({
          txHash: '0xdeadbeef',
          amount: 0.5,
        })),
      };
    };
    injectMockProvider(provider);

    const sdk = await OctraSDK.init({ timeout: 100, skipSignatureVerification: true });
    await sdk.connect({ circle: 'test', appOrigin: 'https://example.com' });
    const cap = await sdk.requestCapability({
      circle: 'test',
      methods: ['stealth_send'],
      scope: 'write',
      encrypted: false,
    });

    await sdk.stealthSend(cap.id, { to: 'octRECIPIENT', amount: 0.5 });

    expect(captured).not.toBeNull();
    expect(captured!.body.method).toBe('stealth_send');

    const payload = extractPayload(captured!);
    expect(payload).toEqual({ to: 'octRECIPIENT', amount: 0.5 });
  });
});

describe('Wire format: encrypt / decrypt', () => {
  beforeEach(() => clearMockProvider());
  afterEach(() => clearMockProvider());

  it('encryptBalance passes { amount } with correct method name', async () => {
    let captured: SignedInvocation | null = null;
    const provider = createMockProvider();
    provider.invoke = async (call: SignedInvocation) => {
      captured = call;
      return {
        success: true,
        data:    new TextEncoder().encode(JSON.stringify({ txHash: '0x1', amount: 1 })),
      };
    };
    injectMockProvider(provider);

    const sdk = await OctraSDK.init({ timeout: 100, skipSignatureVerification: true });
    await sdk.connect({ circle: 't', appOrigin: 'https://example.com' });
    const cap = await sdk.requestCapability({
      circle: 't', methods: ['encrypt_balance'], scope: 'write', encrypted: false,
    });

    await sdk.encryptBalance(cap.id, 1.0);

    expect(captured!.body.method).toBe('encrypt_balance');
    expect(extractPayload(captured!)).toEqual({ amount: 1 });
  });

  it('decryptBalance passes { amount } with correct method name', async () => {
    let captured: SignedInvocation | null = null;
    const provider = createMockProvider();
    provider.invoke = async (call: SignedInvocation) => {
      captured = call;
      return {
        success: true,
        data:    new TextEncoder().encode(JSON.stringify({ txHash: '0x1', amount: 2 })),
      };
    };
    injectMockProvider(provider);

    const sdk = await OctraSDK.init({ timeout: 100, skipSignatureVerification: true });
    await sdk.connect({ circle: 't', appOrigin: 'https://example.com' });
    const cap = await sdk.requestCapability({
      circle: 't', methods: ['decrypt_balance'], scope: 'write', encrypted: false,
    });

    await sdk.decryptBalance(cap.id, 2.0);

    expect(captured!.body.method).toBe('decrypt_balance');
    expect(extractPayload(captured!)).toEqual({ amount: 2 });
  });
});

describe('Invocation canonicalization', () => {
  beforeEach(() => clearMockProvider());
  afterEach(() => clearMockProvider());

  it('every invocation carries a sha256 payloadHash', async () => {
    let captured: SignedInvocation | null = null;
    const provider = createMockProvider();
    provider.invoke = async (call: SignedInvocation) => {
      captured = call;
      return { success: true, data: new Uint8Array([1]) };
    };
    injectMockProvider(provider);

    const sdk = await OctraSDK.init({ timeout: 100, skipSignatureVerification: true });
    await sdk.connect({ circle: 't', appOrigin: 'https://example.com' });
    const cap = await sdk.requestCapability({
      circle: 't', methods: ['get_epoch'], scope: 'read', encrypted: false,
    });

    await sdk.invoke({ capabilityId: cap.id, method: 'get_epoch' });

    // No payload -> empty hash
    expect(captured!.body.payloadHash).toBe('');

    // With payload -> 64-char hex (sha256)
    await sdk.invoke({
      capabilityId: cap.id,
      method: 'get_epoch',
      payload: new TextEncoder().encode('{"hash":"abc"}'),
    });
    expect(captured!.body.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
