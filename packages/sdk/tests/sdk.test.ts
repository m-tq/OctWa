import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OctraSDK } from '../src/sdk';
import {
  NotInstalledError,
  NotConnectedError,
  UserRejectedError,
  ValidationError,
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

  describe('isInstalled', () => {
    it('should return true when provider exists', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      
      expect(sdk.isInstalled()).toBe(true);
    });

    it('should return false when provider does not exist', async () => {
      const sdk = await OctraSDK.init({ timeout: 100 });
      
      expect(sdk.isInstalled()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      const result = await sdk.connect();

      expect(result.address).toBe('oct1mock_address_123');
      expect(sdk.isConnected()).toBe(true);
    });

    it('should throw NotInstalledError when provider not available', async () => {
      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(sdk.connect()).rejects.toThrow(NotInstalledError);
    });

    it('should throw UserRejectedError when user rejects', async () => {
      const mockProvider = createMockProvider({ shouldReject: true });
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(sdk.connect()).rejects.toThrow(UserRejectedError);
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();
      
      expect(sdk.isConnected()).toBe(true);
      
      await sdk.disconnect();
      
      expect(sdk.isConnected()).toBe(false);
    });
  });

  describe('getAccount', () => {
    it('should return address when connected', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      expect(sdk.getAccount()).toBe('oct1mock_address_123');
    });

    it('should throw NotConnectedError when not connected', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      expect(() => sdk.getAccount()).toThrow(NotConnectedError);
    });
  });

  describe('sendTransaction', () => {
    it('should send transaction successfully', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      const result = await sdk.sendTransaction({
        to: 'oct1recipient',
        amount: '1000',
      });

      expect(result.hash).toMatch(/^tx_mock_hash_/);
    });

    it('should throw ValidationError for missing to address', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      await expect(sdk.sendTransaction({
        to: '',
        amount: '1000',
      })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid amount', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      await expect(sdk.sendTransaction({
        to: 'oct1recipient',
        amount: 'invalid',
      })).rejects.toThrow(ValidationError);
    });

    it('should throw NotConnectedError when not connected', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });

      await expect(sdk.sendTransaction({
        to: 'oct1recipient',
        amount: '1000',
      })).rejects.toThrow(NotConnectedError);
    });
  });

  describe('signMessage', () => {
    it('should sign message successfully', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      const result = await sdk.signMessage('Hello World');

      expect(result.signature).toMatch(/^sig_mock_/);
      expect(result.message).toBe('Hello World');
    });

    it('should throw ValidationError for empty message', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      await expect(sdk.signMessage('')).rejects.toThrow(ValidationError);
    });
  });

  describe('callContract', () => {
    it('should call contract view method', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      const result = await sdk.callContract('oct1contract', 'getBalance', { account: 'oct1user' });

      expect(result).toHaveProperty('result', 'mock_view_result');
    });

    it('should throw ValidationError for empty contract address', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      await expect(sdk.callContract('', 'getBalance')).rejects.toThrow(ValidationError);
    });
  });

  describe('invokeContract', () => {
    it('should invoke contract method', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();

      const result = await sdk.invokeContract('oct1contract', 'transfer', { to: 'oct1recipient', amount: '100' });

      expect(result.hash).toMatch(/^contract_tx_/);
    });
  });

  describe('events', () => {
    it('should emit connect event on successful connection', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      
      let emittedAddress: string | null = null;
      sdk.on('connect', ({ address }) => {
        emittedAddress = address;
      });

      await sdk.connect();

      expect(emittedAddress).toBe('oct1mock_address_123');
    });

    it('should emit disconnect event on disconnect', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      await sdk.connect();
      
      let disconnected = false;
      sdk.on('disconnect', () => {
        disconnected = true;
      });

      await sdk.disconnect();

      expect(disconnected).toBe(true);
    });

    it('should unsubscribe with returned function', async () => {
      const mockProvider = createMockProvider();
      injectMockProvider(mockProvider);

      const sdk = await OctraSDK.init({ timeout: 100 });
      
      let callCount = 0;
      const unsubscribe = sdk.on('connect', () => {
        callCount++;
      });

      await sdk.connect();
      expect(callCount).toBe(1);

      unsubscribe();
      await sdk.disconnect();
      await sdk.connect();
      
      // Should still be 1 because we unsubscribed
      expect(callCount).toBe(1);
    });
  });
});
