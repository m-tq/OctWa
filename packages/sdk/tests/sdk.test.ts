import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OctraSDK } from '../src/sdk';
import {
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  ValidationError,
  CapabilityError,
  ScopeViolationError,
} from '../src/errors';
import { createMockProvider, injectMockProvider, clearMockProvider } from './mocks/provider';

describe('OctraSDK', () => {
  beforeEach(() => {
    clearMockProvider();
  });

  afterEach(() => {
    clearMockProvider();
  });

  describe('init', () => {
    it('should initialize with provider when available', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      expect(sdk.isInstalled()).toBe(true);
    });

    it('should initialize without provider when not available', async () => {
      const sdk = await OctraSDK.init({ timeout: 100 });

      expect(sdk.isInstalled()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect successfully without signing', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      const result = await sdk.connect({
        circle: 'test-circle',
        appOrigin: 'https://example.com',
      });

      expect(result.circle).toBe('test-circle');
      expect(result.sessionId).toBeDefined();
      expect(result.walletPubKey).toBeDefined();
      expect(result.network).toBe('testnet');
    });

    it('should throw NotInstalledError when provider not available', async () => {
      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(
        sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' })
      ).rejects.toThrow(NotInstalledError);
    });

    it('should throw ValidationError for empty circle ID', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(
        sdk.connect({ circle: '', appOrigin: 'https://example.com' })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for empty appOrigin', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(
        sdk.connect({ circle: 'test-circle', appOrigin: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw UserRejectedError when user rejects', async () => {
      const mockProvider = createMockProvider({ shouldRejectConnect: true });
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(
        sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' })
      ).rejects.toThrow(UserRejectedError);
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear state', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      const stateBefore = sdk.getSessionState();
      expect(stateBefore.connected).toBe(true);

      await sdk.disconnect();

      const stateAfter = sdk.getSessionState();
      expect(stateAfter.connected).toBe(false);
      expect(stateAfter.activeCapabilities).toHaveLength(0);
    });
  });


  describe('requestCapability', () => {
    it('should request capability successfully', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      const capability = await sdk.requestCapability({
        circle: 'test-circle',
        methods: ['getData', 'setData'],
        scope: 'write',
        encrypted: false,
      });

      expect(capability.id).toBeDefined();
      expect(capability.circle).toBe('test-circle');
      expect(capability.methods).toEqual(['getData', 'setData']);
      expect(capability.scope).toBe('write');
      expect(capability.encrypted).toBe(false);
      expect(capability.signature).toBeDefined();
    });

    it('should throw NotConnectedError when not connected', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(
        sdk.requestCapability({
          circle: 'test-circle',
          methods: ['getData'],
          scope: 'read',
          encrypted: false,
        })
      ).rejects.toThrow(NotConnectedError);
    });

    it('should throw ValidationError for empty methods', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      await expect(
        sdk.requestCapability({
          circle: 'test-circle',
          methods: [],
          scope: 'read',
          encrypted: false,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid scope', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      await expect(
        sdk.requestCapability({
          circle: 'test-circle',
          methods: ['getData'],
          scope: 'invalid' as 'read',
          encrypted: false,
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw UserRejectedError when user rejects', async () => {
      const mockProvider = createMockProvider({ shouldRejectCapability: true });
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      await expect(
        sdk.requestCapability({
          circle: 'test-circle',
          methods: ['getData'],
          scope: 'read',
          encrypted: false,
        })
      ).rejects.toThrow(UserRejectedError);
    });
  });

  describe('invoke', () => {
    it('should invoke method successfully', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      const capability = await sdk.requestCapability({
        circle: 'test-circle',
        methods: ['getData'],
        scope: 'read',
        encrypted: false,
      });

      const result = await sdk.invoke({
        capabilityId: capability.id,
        method: 'getData',
      });

      expect(result.success).toBe(true);
    });

    it('should throw CapabilityError for invalid capability', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      await expect(
        sdk.invoke({
          capabilityId: 'non-existent-cap',
          method: 'getData',
        })
      ).rejects.toThrow(CapabilityError);
    });

    it('should throw ScopeViolationError for method not in scope', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      const capability = await sdk.requestCapability({
        circle: 'test-circle',
        methods: ['getData'],
        scope: 'read',
        encrypted: false,
      });

      await expect(
        sdk.invoke({
          capabilityId: capability.id,
          method: 'setData', // Not in allowed methods
        })
      ).rejects.toThrow(ScopeViolationError);
    });

    it('should pass EncryptedBlob payload verbatim', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      const capability = await sdk.requestCapability({
        circle: 'test-circle',
        methods: ['processData'],
        scope: 'compute',
        encrypted: true,
      });

      const encryptedPayload = {
        scheme: 'HFHE' as const,
        data: new Uint8Array([1, 2, 3, 4, 5]),
        metadata: new Uint8Array([10, 20]),
      };

      const result = await sdk.invoke({
        capabilityId: capability.id,
        method: 'processData',
        payload: encryptedPayload,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getSessionState', () => {
    it('should return correct state when not connected', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      const state = sdk.getSessionState();

      expect(state.connected).toBe(false);
      expect(state.circle).toBeUndefined();
      expect(state.activeCapabilities).toHaveLength(0);
    });

    it('should return correct state when connected', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      const state = sdk.getSessionState();

      expect(state.connected).toBe(true);
      expect(state.circle).toBe('test-circle');
    });

    it('should include active capabilities', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      await sdk.requestCapability({
        circle: 'test-circle',
        methods: ['getData'],
        scope: 'read',
        encrypted: false,
      });

      const state = sdk.getSessionState();

      expect(state.activeCapabilities).toHaveLength(1);
      expect(state.activeCapabilities[0].methods).toEqual(['getData']);
    });
  });

  describe('events', () => {
    it('should emit connect event on successful connection', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      let emittedConnection: unknown = null;
      sdk.on('connect', ({ connection }) => {
        emittedConnection = connection;
      });

      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      expect(emittedConnection).not.toBeNull();
      expect((emittedConnection as { circle: string }).circle).toBe('test-circle');
    });

    it('should emit disconnect event on disconnect', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      let disconnected = false;
      sdk.on('disconnect', () => {
        disconnected = true;
      });

      await sdk.disconnect();

      expect(disconnected).toBe(true);
    });

    it('should emit capabilityGranted event', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      let grantedCapability: unknown = null;
      sdk.on('capabilityGranted', ({ capability }) => {
        grantedCapability = capability;
      });

      await sdk.requestCapability({
        circle: 'test-circle',
        methods: ['getData'],
        scope: 'read',
        encrypted: false,
      });

      expect(grantedCapability).not.toBeNull();
    });

    it('should unsubscribe with returned function', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      let callCount = 0;
      const unsubscribe = sdk.on('connect', () => {
        callCount++;
      });

      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });
      expect(callCount).toBe(1);

      unsubscribe();
      await sdk.disconnect();
      await sdk.connect({ circle: 'test-circle', appOrigin: 'https://example.com' });

      // Should still be 1 because we unsubscribed
      expect(callCount).toBe(1);
    });
  });

  describe('no signMessage API', () => {
    it('should NOT have signMessage method', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      // Verify signMessage does not exist
      expect((sdk as unknown as Record<string, unknown>).signMessage).toBeUndefined();
    });

    it('should NOT have signRaw method', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      // Verify signRaw does not exist
      expect((sdk as unknown as Record<string, unknown>).signRaw).toBeUndefined();
    });
  });
});
