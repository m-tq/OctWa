import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import {
  isPoint,
  pointAdd,
  pointAddScalar,
  pointCompress,
  pointFromScalar,
  isPrivate,
  pointMultiply,
  privateAdd,
  privateNegate,
  privateSub,
  sign,
  signSchnorr,
  verify,
  verifySchnorr,
  xOnlyPointAddTweak,
} from '@bitcoinerlab/secp256k1';
import * as ed25519 from 'ed25519-hd-key';
import bs58 from 'bs58';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import * as nacl from 'tweetnacl';

// Explicitly construct the ECC interface to avoid module resolution issues
// and ensure compatibility with BIP32Factory requirements
const ecc = {
  isPoint,
  pointAdd,
  pointAddScalar,
  pointCompress,
  pointFromScalar,
  isPrivate,
  pointMultiply,
  privateAdd,
  privateNegate,
  privateSub,
  sign,
  signSchnorr,
  verify,
  verifySchnorr,
  xOnlyPointAddTweak,
};

const bip32 = BIP32Factory(ecc);

export enum ChainType {
  EVM = 'evm',
  SOLANA = 'solana',
  BITCOIN = 'bitcoin',
  TRON = 'tron',
  COSMOS = 'cosmos'
}

export interface KeyPair {
  address: string;
  privateKey: string;
  publicKey: string;
}

export class KeyManager {
  private seed?: Buffer;
  private root?: any; // bip32 root
  private rawPrivateKey?: string; // hex string without 0x

  constructor(secret: string) {
    // Simple heuristic: mnemonics contain spaces
    if (secret.trim().includes(' ')) {
      this.seed = bip39.mnemonicToSeedSync(secret);
      this.root = bip32.fromSeed(this.seed);
    } else {
      // Assume private key
      this.rawPrivateKey = secret.startsWith('0x') ? secret.slice(2) : secret;
    }
  }

  // EVM (Ethereum, BSC, Polygon, etc.) - BIP-44: m/44'/60'/0'/0/index
  getEvmKey(index = 0): KeyPair {
    if (this.root) {
      const path = `m/44'/60'/0'/0/${index}`;
      const child = this.root.derivePath(path);
      const wallet = new ethers.Wallet(Buffer.from(child.privateKey!).toString('hex'));
      return { 
        address: wallet.address, 
        privateKey: wallet.privateKey,
        publicKey: wallet.signingKey.publicKey
      };
    } else if (this.rawPrivateKey) {
      // Private key mode - ignore index as we only have one key
      const wallet = new ethers.Wallet(this.rawPrivateKey);
      return {
        address: wallet.address,
        privateKey: wallet.privateKey,
        publicKey: wallet.signingKey.publicKey
      };
    }
    throw new Error('KeyManager not initialized properly');
  }

  // Solana - BIP-44: m/44'/501'/index'/0' (Hardened)
  getSolanaKey(index = 0): KeyPair {
    if (this.root && this.seed) {
      const path = `m/44'/501'/${index}'/0'`;
      const derived = ed25519.derivePath(path, this.seed.toString('hex'));
      const keyPair = nacl.sign.keyPair.fromSeed(derived.key);
      const publicKey = bs58.encode(Buffer.from(keyPair.publicKey));
      const privateKey = bs58.encode(Buffer.from(keyPair.secretKey));
      
      return {
        address: publicKey,
        privateKey: privateKey,
        publicKey: publicKey
      };
    } else {
      // Solana uses Ed25519, incompatible with Secp256k1 private key
      throw new Error('Cannot derive Solana key from Secp256k1 private key. Mnemonic required.');
    }
  }

  // Bitcoin - BIP-84 (Native SegWit): m/84'/0'/0'/0/index
  getBitcoinKey(index = 0): KeyPair {
    let publicKey: Buffer;
    let privateKeyHex: string;

    if (this.root) {
      const path = `m/84'/0'/0'/0/${index}`;
      const child = this.root.derivePath(path);
      publicKey = child.publicKey;
      privateKeyHex = Buffer.from(child.privateKey!).toString('hex');
    } else if (this.rawPrivateKey) {
      const wallet = new ethers.Wallet(this.rawPrivateKey);
      // Ethers pubkey is 0x04... (uncompressed) or 0x02/0x03 (compressed)
      // We need compressed for SegWit usually
      privateKeyHex = this.rawPrivateKey;
      // Get compressed public key
      publicKey = Buffer.from(ethers.getBytes(wallet.signingKey.compressedPublicKey));
    } else {
      throw new Error('KeyManager not initialized properly');
    }
    
    // P2WPKH address generation
    const { sha256 } = ethers;
    const ripemd160 = (data: Uint8Array) => ethers.ripemd160(data);
    
    // Hash160 = RIPEMD160(SHA256(pubkey))
    const sha256Hash = ethers.getBytes(sha256(publicKey));
    const pubKeyHash = ethers.getBytes(ripemd160(sha256Hash));
    
    // Bech32 encode with 'bc' prefix and version 0
    const words = bech32.toWords(pubKeyHash);
    words.unshift(0); // Version 0
    const address = bech32.encode('bc', words);
    
    return {
      address: address,
      privateKey: privateKeyHex,
      publicKey: Buffer.from(publicKey).toString('hex')
    };
  }

  // TRON - BIP-44: m/44'/195'/0'/0/index
  getTronKey(index = 0): KeyPair {
    let privateKeyHex: string;
    let publicKey: string;

    if (this.root) {
      const path = `m/44'/195'/0'/0/${index}`;
      const child = this.root.derivePath(path);
      privateKeyHex = Buffer.from(child.privateKey!).toString('hex');
    } else if (this.rawPrivateKey) {
      privateKeyHex = this.rawPrivateKey;
    } else {
      throw new Error('KeyManager not initialized properly');
    }

    const wallet = new ethers.Wallet(privateKeyHex);
    publicKey = wallet.signingKey.publicKey;
    
    // Tron address generation:
    // 1. Get public key (uncompressed), strip 0x04 prefix -> 64 bytes
    // 2. Keccak256(public key) -> take last 20 bytes
    // 3. Add 0x41 prefix
    // 4. Base58Check encode
    
    const ethAddress = wallet.address; // 0x...
    const tronAddressHex = "41" + ethAddress.slice(2);
    
    // Base58Check encode: data + sha256(sha256(data))[:4]
    const data = Buffer.from(tronAddressHex, 'hex');
    const hash1 = ethers.getBytes(ethers.sha256(data));
    const hash2 = ethers.getBytes(ethers.sha256(hash1));
    const checksum = hash2.slice(0, 4);
    const addressBytes = Buffer.concat([data, Buffer.from(checksum)]);
    const address = bs58.encode(addressBytes);
    
    return {
      address: address,
      privateKey: privateKeyHex,
      publicKey: publicKey
    };
  }

  // Cosmos - BIP-44: m/44'/118'/0'/0/index
  getCosmosKey(index = 0): KeyPair {
    let publicKey: Buffer;
    let privateKeyHex: string;

    if (this.root) {
      const path = `m/44'/118'/0'/0/${index}`;
      const child = this.root.derivePath(path);
      publicKey = child.publicKey;
      privateKeyHex = Buffer.from(child.privateKey!).toString('hex');
    } else if (this.rawPrivateKey) {
      const wallet = new ethers.Wallet(this.rawPrivateKey);
      privateKeyHex = this.rawPrivateKey;
      // Cosmos usually uses compressed public keys
      publicKey = Buffer.from(ethers.getBytes(wallet.signingKey.compressedPublicKey));
    } else {
      throw new Error('KeyManager not initialized properly');
    }
    
    // Cosmos address: bech32(ripemd160(sha256(pubkey))) with prefix 'cosmos'
    const { sha256 } = ethers;
    const ripemd160 = (data: Uint8Array) => ethers.ripemd160(data);
    
    const sha256Hash = ethers.getBytes(sha256(publicKey));
    const pubKeyHash = ethers.getBytes(ripemd160(sha256Hash));
    
    const words = bech32.toWords(pubKeyHash);
    const address = bech32.encode('cosmos', words);
    
    return {
      address: address,
      privateKey: privateKeyHex,
      publicKey: Buffer.from(publicKey).toString('hex')
    };
  }

  // Helper to get all keys at once
  getAllKeys(index = 0) {
    const keys: any = {};
    
    try { keys[ChainType.EVM] = this.getEvmKey(index); } catch (e) {}
    try { keys[ChainType.SOLANA] = this.getSolanaKey(index); } catch (e) {}
    try { keys[ChainType.BITCOIN] = this.getBitcoinKey(index); } catch (e) {}
    try { keys[ChainType.TRON] = this.getTronKey(index); } catch (e) {}
    try { keys[ChainType.COSMOS] = this.getCosmosKey(index); } catch (e) {}
    
    return keys;
  }
}
