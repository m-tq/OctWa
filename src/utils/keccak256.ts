/**
 * Keccak-256 implementation for Ethereum address derivation
 * This is the original Keccak (not SHA3-256 which has different padding)
 */

const RATE = 136; // (1600 - 256*2) / 8

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

const ROTATION: number[][] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];

function rotateLeft(x: bigint, n: number): bigint {
  const mask = 0xFFFFFFFFFFFFFFFFn;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & mask;
}

function keccakF(state: bigint[][]): bigint[][] {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C: bigint[] = [];
    for (let x = 0; x < 5; x++) {
      C[x] = state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4];
    }
    
    const D: bigint[] = [];
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rotateLeft(C[(x + 1) % 5], 1);
    }
    
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x][y] ^= D[x];
      }
    }

    // Rho and Pi
    const B: bigint[][] = Array(5).fill(null).map(() => Array(5).fill(0n));
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y][(2 * x + 3 * y) % 5] = rotateLeft(state[x][y], ROTATION[x][y]);
      }
    }

    // Chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]);
      }
    }

    // Iota
    state[0][0] ^= RC[round];
  }

  return state;
}

function bytesToLittleEndianU64(bytes: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(bytes[offset + i] || 0) << BigInt(i * 8);
  }
  return result;
}

function littleEndianU64ToBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number((value >> BigInt(i * 8)) & 0xFFn);
  }
  return bytes;
}

/**
 * Keccak-256 hash function
 * @param data Input data as Uint8Array
 * @returns 32-byte hash as Uint8Array
 */
export function keccak256(data: Uint8Array): Uint8Array {
  // Padding (Keccak uses 0x01 padding, not SHA3's 0x06)
  const padded = new Uint8Array(Math.ceil((data.length + 1) / RATE) * RATE);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  // Initialize state (5x5 array of 64-bit values)
  const state: bigint[][] = Array(5).fill(null).map(() => Array(5).fill(0n));

  // Absorb
  for (let blockStart = 0; blockStart < padded.length; blockStart += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      const x = i % 5;
      const y = Math.floor(i / 5);
      state[x][y] ^= bytesToLittleEndianU64(padded, blockStart + i * 8);
    }
    keccakF(state);
  }

  // Squeeze (only need 32 bytes for Keccak-256)
  const output = new Uint8Array(32);
  let outputOffset = 0;
  
  outer:
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const bytes = littleEndianU64ToBytes(state[x][y]);
      for (let i = 0; i < 8; i++) {
        if (outputOffset >= 32) break outer;
        output[outputOffset++] = bytes[i];
      }
    }
  }

  return output;
}

/**
 * Keccak-256 hash as hex string
 */
export function keccak256Hex(data: Uint8Array): string {
  return Array.from(keccak256(data)).map(b => b.toString(16).padStart(2, '0')).join('');
}
