/**
 * EVM Address Derivation from Octra Private Key
 * Derives EVM-compatible address using secp256k1 curve
 */

import { keccak256 } from './keccak256';

// secp256k1 curve parameters
const P = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const Gx = BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798');
const Gy = BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8');

type Point = [bigint, bigint] | null;

function modInverse(a: bigint, m: bigint): bigint {
  if (a < 0n) a = ((a % m) + m) % m;
  let [g, x] = extendedGcd(a, m);
  if (g !== 1n) throw new Error('Modular inverse does not exist');
  return ((x % m) + m) % m;
}

function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (a === 0n) return [b, 0n, 1n];
  const [gcd, x1, y1] = extendedGcd(b % a, a);
  const x = y1 - (b / a) * x1;
  const y = x1;
  return [gcd, x, y];
}

function pointAdd(p1: Point, p2: Point): Point {
  if (p1 === null) return p2;
  if (p2 === null) return p1;

  const [x1, y1] = p1;
  const [x2, y2] = p2;

  if (x1 === x2 && y1 !== y2) return null;

  let m: bigint;
  if (x1 === x2) {
    m = (3n * x1 * x1 * modInverse(2n * y1, P)) % P;
  } else {
    m = ((y2 - y1) * modInverse(x2 - x1, P)) % P;
  }

  const x3 = ((m * m - x1 - x2) % P + P) % P;
  const y3 = ((m * (x1 - x3) - y1) % P + P) % P;

  return [x3, y3];
}

function scalarMult(k: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;

  while (k > 0n) {
    if (k & 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }

  return result;
}

function privateKeyToPublicKey(privateKeyBytes: Uint8Array): Uint8Array {
  const privateKeyInt = BigInt('0x' + Array.from(privateKeyBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
  const publicPoint = scalarMult(privateKeyInt, [Gx, Gy]);

  if (!publicPoint) throw new Error('Invalid private key');

  const xBytes = bigIntToBytes(publicPoint[0], 32);
  const yBytes = bigIntToBytes(publicPoint[1], 32);

  // Uncompressed public key (without 04 prefix)
  const result = new Uint8Array(64);
  result.set(xBytes, 0);
  result.set(yBytes, 32);
  return result;
}

function bigIntToBytes(num: bigint, length: number): Uint8Array {
  const hex = num.toString(16).padStart(length * 2, '0');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Base64 private key to hex format
 */
export function b64ToHex(privateKeyB64: string): string {
  const binaryString = atob(privateKeyB64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Handle different key lengths
  if (bytes.length === 32) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } else if (bytes.length === 64) {
    // ed25519 full key (32 private + 32 public), take first 32 bytes
    return Array.from(bytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  console.warn(`Key length ${bytes.length} bytes, expected 32`);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get EVM address from private key hex
 */
export function getEvmAddress(privateKeyHex: string): string {
  const privateKeyBytes = new Uint8Array(privateKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Generate public key
  const publicKey = privateKeyToPublicKey(privateKeyBytes);
  
  // Keccak-256 hash of public key
  const addressBytes = keccak256(publicKey);
  
  // Take last 20 bytes
  const address = Array.from(addressBytes.slice(-20)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // EIP-55 checksum encoding
  const addressHash = Array.from(keccak256(new TextEncoder().encode(address))).map(b => b.toString(16).padStart(2, '0')).join('');
  
  let checksumAddress = '0x';
  for (let i = 0; i < address.length; i++) {
    const char = address[i];
    if ('0123456789'.includes(char)) {
      checksumAddress += char;
    } else if (parseInt(addressHash[i], 16) >= 8) {
      checksumAddress += char.toUpperCase();
    } else {
      checksumAddress += char.toLowerCase();
    }
  }
  
  return checksumAddress;
}

/**
 * Derive EVM address from Octra private key (Base64)
 */
export function deriveEvmFromOctraKey(privateKeyB64: string): { privateKeyHex: string; evmAddress: string } {
  const privateKeyHex = b64ToHex(privateKeyB64);
  const evmAddress = getEvmAddress(privateKeyHex);
  
  return {
    privateKeyHex,
    evmAddress
  };
}

/**
 * Get EVM data for a wallet
 */
export interface EVMWalletData {
  octraAddress: string;
  evmAddress: string;
  privateKeyHex: string;
}

export function getEVMWalletData(octraAddress: string, privateKeyB64: string): EVMWalletData {
  const { privateKeyHex, evmAddress } = deriveEvmFromOctraKey(privateKeyB64);
  return {
    octraAddress,
    evmAddress,
    privateKeyHex
  };
}
