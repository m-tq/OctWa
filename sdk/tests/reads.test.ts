/**
 * Phase 9 read methods — getTransaction, getEpoch, getRecommendedFee,
 * getContractStorage, callContractView, getViewPubkey, stealthScanFull,
 * getDecryptedBalance, waitForConfirmation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OctraSDK } from '../src/sdk';
import type { TransactionInfo } from '../src/types';
import { createMockProvider, injectMockProvider, clearMockProvider } from './mocks/provider';

async function connectedSDK(caps: string[] = ['get_balance', 'get_transaction', 'get_epoch',
  'get_recommended_fee', 'get_contract_storage', 'contract_call_view', 'get_view_pubkey',
  'get_stealth_outputs', 'scan_outputs', 'decrypt_cipher']) {
  const provider = createMockProvider();
  injectMockProvider(provider);
  const sdk = await OctraSDK.init({ timeout: 100, skipSignatureVerification: true });
  await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });
  const cap = await sdk.requestCapability({
    circle: 'test-circle',
    methods: caps,
    scope: 'read',
    encrypted: false,
  });
  return { sdk, cap };
}

describe('SDK Reads', () => {
  beforeEach(() => clearMockProvider());
  afterEach(() => clearMockProvider());

  describe('getTransaction', () => {
    it('returns the shaped TransactionInfo', async () => {
      const { sdk, cap } = await connectedSDK();
      const tx = await sdk.getTransaction(cap.id, 'abc123');
      expect(tx).not.toBeNull();
      expect(tx!.hash).toBe('abc123');
      expect(tx!.status).toBe('confirmed');
      expect(tx!.amountRaw).toBe('1000000');
      expect(tx!.opType).toBe('standard');
    });

    it('rejects on empty hash', async () => {
      const { sdk, cap } = await connectedSDK();
      await expect(sdk.getTransaction(cap.id, '')).rejects.toThrow(/hash/i);
    });
  });

  describe('getEpoch', () => {
    it('returns current epoch info', async () => {
      const { sdk, cap } = await connectedSDK();
      const e = await sdk.getEpoch(cap.id);
      expect(e.epochId).toBeGreaterThan(0);
    });
  });

  describe('getRecommendedFee', () => {
    it('returns the fee envelope for a known op_type', async () => {
      const { sdk, cap } = await connectedSDK();
      const fee = await sdk.getRecommendedFee(cap.id, 'standard');
      expect(fee.recommended).toBeTypeOf('string');
      expect(Number.parseInt(fee.recommended, 10)).toBeGreaterThan(0);
    });

    it('rejects on empty opType', async () => {
      const { sdk, cap } = await connectedSDK();
      await expect(sdk.getRecommendedFee(cap.id, '')).rejects.toThrow(/opType/i);
    });
  });

  describe('getContractStorage', () => {
    it('returns the stored value for a key', async () => {
      const { sdk, cap } = await connectedSDK();
      const v = await sdk.getContractStorage(cap.id, 'oct_contract_addr', 'owner');
      expect(v).toBe('mock-stored-value');
    });

    it('rejects on missing args', async () => {
      const { sdk, cap } = await connectedSDK();
      await expect(sdk.getContractStorage(cap.id, '', 'x')).rejects.toThrow(/contract/);
      await expect(sdk.getContractStorage(cap.id, 'oct_x', '')).rejects.toThrow(/key/);
    });
  });

  describe('callContractView', () => {
    it('returns the view result wrapped in { result }', async () => {
      const { sdk, cap } = await connectedSDK();
      const r = await sdk.callContractView(cap.id, {
        contract: 'oct_x',
        method: 'balance_of',
        params: ['oct_user'],
      });
      expect(r.result).toBe('mock-view-result');
    });
  });

  describe('getViewPubkey', () => {
    it('returns the base64 view pubkey or null', async () => {
      const { sdk, cap } = await connectedSDK();
      const vk = await sdk.getViewPubkey(cap.id, 'oct_counterparty');
      expect(typeof vk).toBe('string');
      expect(vk!.length).toBeGreaterThan(0);
    });
  });

  describe('stealthScanFull', () => {
    it('fetches outputs and delegates to scanOutputs', async () => {
      const { sdk, cap } = await connectedSDK();
      const r = await sdk.stealthScanFull(cap.id, 0);
      expect(r.outputs).toEqual([]);
      expect(r.totalScanned).toBe(0);
      expect(r.matched).toBe(0);
    });
  });

  describe('getDecryptedBalance', () => {
    it('returns public + decrypted encrypted balance', async () => {
      const { sdk, cap } = await connectedSDK();
      const b = await sdk.getDecryptedBalance(cap.id);
      expect(b.octBalance).toBeGreaterThan(0);
      // mock provider returns valueOct = 1.0 for hfhe_v1|... cipher
      expect(b.decryptedEncryptedBalance).toBeGreaterThan(0);
      expect(b.decryptedEncryptedBalanceRaw).toBeGreaterThan(0n);
    });
  });

  describe('waitForConfirmation', () => {
    it('returns immediately when already confirmed', async () => {
      const { sdk, cap } = await connectedSDK();
      const info = await sdk.waitForConfirmation(cap.id, 'abc123', {
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });
      expect(info.status).toBe('confirmed');
    });

    it('calls onTick for each poll', async () => {
      const { sdk, cap } = await connectedSDK();
      const ticks: Array<TransactionInfo | null> = [];
      await sdk.waitForConfirmation(cap.id, 'abc123', {
        timeoutMs: 5000,
        pollIntervalMs: 100,
        onTick: (t) => ticks.push(t),
      });
      expect(ticks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
