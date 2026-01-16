/**
 * Crypto Layer Tests
 * 
 * Tests based on: packages/octra_capability_sdk_deterministic_test_vectors.md
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalizeCapabilityPayload,
  hashCapabilityPayload,
  hexToBytes,
  bytesToHex,
  generateNonce,
  isCapabilityExpired,
  isOriginValid,
} from '../src/crypto';
import type { CapabilityPayload, Capability } from '../src/types';

// Test vector from spec
const TEST_PAYLOAD: CapabilityPayload = {
  version: 1,
  circle: 'analytics_v1',
  methods: ['submit_input', 'read_stats'], // Note: unsorted input
  scope: 'compute',
  encrypted: true,
  appOrigin: 'https://sample.app',
  issuedAt: 1735686000000,
  expiresAt: 1735689600000,
  nonce: '00000000-0000-0000-0000-000000000001',
};

// Expected canonical form from spec
const EXPECTED_CANONICAL = '{"appOrigin":"https://sample.app","circle":"analytics_v1","encrypted":true,"expiresAt":1735689600000,"issuedAt":1735686000000,"methods":["read_stats","submit_input"],"nonce":"00000000-0000-0000-0000-000000000001","scope":"compute","version":1}';

describe('Canonicalization', () => {
  it('should produce deterministic canonical JSON', () => {
    const canonical = canonicalizeCapabilityPayload(TEST_PAYLOAD);
    expect(canonical).toBe(EXPECTED_CANONICAL);
  });

  it('should sort methods array lexicographically', () => {
    const canonical = canonicalizeCapabilityPayload(TEST_PAYLOAD);
    const parsed = JSON.parse(canonical);
    expect(parsed.methods).toEqual(['read_stats', 'submit_input']);
  });

  it('should sort keys lexicographically', () => {
    const canonical = canonicalizeCapabilityPayload(TEST_PAYLOAD);
    const keys = Object.keys(JSON.parse(canonical));
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it('should produce same output regardless of input method order', () => {
    const payload1: CapabilityPayload = {
      ...TEST_PAYLOAD,
      methods: ['submit_input', 'read_stats'],
    };
    const payload2: CapabilityPayload = {
      ...TEST_PAYLOAD,
      methods: ['read_stats', 'submit_input'],
    };
    
    expect(canonicalizeCapabilityPayload(payload1)).toBe(canonicalizeCapabilityPayload(payload2));
  });
});

describe('Hashing', () => {
  it('should produce consistent hash for same payload', async () => {
    const hash1 = await hashCapabilityPayload(TEST_PAYLOAD);
    const hash2 = await hashCapabilityPayload(TEST_PAYLOAD);
    expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
  });

  it('should produce different hash for different payload', async () => {
    const modifiedPayload: CapabilityPayload = {
      ...TEST_PAYLOAD,
      circle: 'different_circle',
    };
    
    const hash1 = await hashCapabilityPayload(TEST_PAYLOAD);
    const hash2 = await hashCapabilityPayload(modifiedPayload);
    expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
  });

  it('should produce 32-byte SHA-256 hash', async () => {
    const hash = await hashCapabilityPayload(TEST_PAYLOAD);
    expect(hash.length).toBe(32);
  });
});

describe('Byte Conversion', () => {
  it('should convert hex to bytes correctly', () => {
    const hex = 'd75a9801';
    const bytes = hexToBytes(hex);
    expect(bytes.length).toBe(4);
    expect(bytes[0]).toBe(0xd7);
    expect(bytes[1]).toBe(0x5a);
    expect(bytes[2]).toBe(0x98);
    expect(bytes[3]).toBe(0x01);
  });

  it('should convert bytes to hex correctly', () => {
    const bytes = new Uint8Array([0xd7, 0x5a, 0x98, 0x01]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('d75a9801');
  });

  it('should roundtrip hex -> bytes -> hex', () => {
    const original = 'd75a980182b10ab7d54bfed3c964073a';
    const bytes = hexToBytes(original);
    const result = bytesToHex(bytes);
    expect(result).toBe(original);
  });

  it('should handle hex with whitespace', () => {
    const hex = 'd75a 9801 82b1 0ab7';
    const bytes = hexToBytes(hex);
    expect(bytes.length).toBe(8);
  });

  it('should throw on invalid hex', () => {
    expect(() => hexToBytes('xyz')).toThrow();
    expect(() => hexToBytes('d75')).toThrow(); // odd length
  });
});

describe('Nonce Generation', () => {
  it('should generate UUID-like nonce', () => {
    const nonce = generateNonce();
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    expect(nonces.size).toBe(100);
  });
});

describe('Capability Expiry', () => {
  it('should detect expired capability', () => {
    const expiredCap = {
      expiresAt: Date.now() - 1000, // 1 second ago
    } as Capability;
    
    expect(isCapabilityExpired(expiredCap)).toBe(true);
  });

  it('should detect valid capability', () => {
    const validCap = {
      expiresAt: Date.now() + 3600000, // 1 hour from now
    } as Capability;
    
    expect(isCapabilityExpired(validCap)).toBe(false);
  });
});

describe('Origin Validation', () => {
  it('should validate matching origin', () => {
    const cap = {
      appOrigin: 'https://sample.app',
    } as Capability;
    
    expect(isOriginValid(cap, 'https://sample.app')).toBe(true);
  });

  it('should reject mismatched origin', () => {
    const cap = {
      appOrigin: 'https://sample.app',
    } as Capability;
    
    expect(isOriginValid(cap, 'https://evil.app')).toBe(false);
  });

  it('should be case-sensitive', () => {
    const cap = {
      appOrigin: 'https://Sample.App',
    } as Capability;
    
    expect(isOriginValid(cap, 'https://sample.app')).toBe(false);
  });
});

describe('Negative Test Vectors', () => {
  it('should produce different canonical form when method order matters for signature', () => {
    // The canonical form should always sort methods, so this tests that
    // if someone tries to verify with wrong order, it would fail
    const payload1: CapabilityPayload = {
      ...TEST_PAYLOAD,
      methods: ['submit_input', 'read_stats'],
    };
    
    // Manually create "wrong" canonical (unsorted methods)
    const wrongCanonical = JSON.stringify({
      appOrigin: payload1.appOrigin,
      circle: payload1.circle,
      encrypted: payload1.encrypted,
      expiresAt: payload1.expiresAt,
      issuedAt: payload1.issuedAt,
      methods: ['submit_input', 'read_stats'], // Wrong order
      nonce: payload1.nonce,
      scope: payload1.scope,
      version: payload1.version,
    });
    
    const correctCanonical = canonicalizeCapabilityPayload(payload1);
    expect(wrongCanonical).not.toBe(correctCanonical);
  });

  it('should produce different hash when scope is tampered', async () => {
    const originalPayload = TEST_PAYLOAD;
    const tamperedPayload: CapabilityPayload = {
      ...TEST_PAYLOAD,
      scope: 'write', // Changed from 'compute'
    };
    
    const originalHash = await hashCapabilityPayload(originalPayload);
    const tamperedHash = await hashCapabilityPayload(tamperedPayload);
    
    expect(bytesToHex(originalHash)).not.toBe(bytesToHex(tamperedHash));
  });

  it('should produce different hash when origin is tampered', async () => {
    const originalPayload = TEST_PAYLOAD;
    const tamperedPayload: CapabilityPayload = {
      ...TEST_PAYLOAD,
      appOrigin: 'https://evil.app', // Changed origin
    };
    
    const originalHash = await hashCapabilityPayload(originalPayload);
    const tamperedHash = await hashCapabilityPayload(tamperedPayload);
    
    expect(bytesToHex(originalHash)).not.toBe(bytesToHex(tamperedHash));
  });
});
