import { Wallet } from '../types/wallet';
import { generateMnemonic, validateMnemonic, generateWalletFromMnemonic, bufferToBase64, bufferToHex, createOctraAddress } from './crypto';
import * as nacl from 'tweetnacl';

export async function generateWallet(): Promise<Wallet> {
  let walletData;
  let attempts = 0;
  const maxAttempts = 100; // Prevent infinite loop
  
  do {
    const mnemonic = generateMnemonic();
    walletData = await generateWalletFromMnemonic(mnemonic);
    attempts++;
    
    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate wallet with 47-character address after maximum attempts');
    }
  } while (walletData.address.length !== 47);
  
  return {
    address: walletData.address,
    privateKey: walletData.privateKey,
    mnemonic: walletData.mnemonic,
    publicKey: walletData.publicKey,
    type: 'generated'
  };
}

export async function importWalletFromPrivateKey(privateKey: string): Promise<Wallet> {
  let cleanKey = privateKey.trim();
  
  // Handle base64 format only
  let keyBuffer: Buffer;
  
  // Base64 format only
  try {
    keyBuffer = Buffer.from(cleanKey, 'base64');
    if (keyBuffer.length !== 32) {
      throw new Error('Invalid private key length');
    }
  } catch (error) {
    throw new Error('Invalid private key format');
  }
  
  // Verify the private key by creating a keypair
  try {
    const keyPair = nacl.sign.keyPair.fromSeed(keyBuffer);
    const publicKey = Buffer.from(keyPair.publicKey);
    const address = await createOctraAddress(publicKey);
    
    return {
      address,
      privateKey: bufferToBase64(keyBuffer),
      publicKey: bufferToHex(publicKey),
      type: 'imported-private-key'
    };
  } catch (error) {
    throw new Error('Failed to create wallet from private key');
  }
}

export async function importWalletFromMnemonic(mnemonic: string): Promise<Wallet> {
  const words = mnemonic.trim().split(/\s+/);
  
  if (words.length !== 12 && words.length !== 24) {
    throw new Error('Invalid mnemonic length. Must be 12 or 24 words.');
  }
  
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }
  
  const walletData = await generateWalletFromMnemonic(mnemonic);
  
  return {
    address: walletData.address,
    privateKey: walletData.privateKey,
    mnemonic: walletData.mnemonic,
    publicKey: walletData.publicKey,
    type: 'imported-mnemonic'
  };
}

export function getWalletBalance(address: string): Promise<number> {
  // This would connect to the actual blockchain
  // For now, return a mock balance
  return Promise.resolve(Math.random() * 100);
}