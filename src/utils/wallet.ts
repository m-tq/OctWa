import { Wallet } from '../types/wallet';
import {
  generateMnemonic,
  validateMnemonic,
  generateWalletFromMnemonic,
  bufferToBase64,
  bufferToHex,
  createOctraAddress,
} from './crypto';
import * as nacl from 'tweetnacl';

const EXPECTED_ADDRESS_LENGTH = 47;
const MAX_GENERATION_ATTEMPTS = 100;

export async function generateWallet(): Promise<Wallet> {
  let walletData;
  let attempts = 0;

  do {
    if (attempts >= MAX_GENERATION_ATTEMPTS) {
      throw new Error(
        `Failed to generate wallet with ${EXPECTED_ADDRESS_LENGTH}-character address after ${MAX_GENERATION_ATTEMPTS} attempts`,
      );
    }
    walletData = await generateWalletFromMnemonic(generateMnemonic());
    attempts++;
  } while (walletData.address.length !== EXPECTED_ADDRESS_LENGTH);

  return {
    address: walletData.address,
    privateKey: walletData.privateKey,
    mnemonic: walletData.mnemonic,
    publicKey: walletData.publicKey,
    type: 'generated',
  };
}

export async function importWalletFromPrivateKey(privateKey: string): Promise<Wallet> {
  const cleanKey = privateKey.trim();

  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(cleanKey, 'base64');
    if (keyBuffer.length !== 32) throw new Error('Invalid private key length');
  } catch {
    throw new Error('Invalid private key format');
  }

  try {
    const keyPair = nacl.sign.keyPair.fromSeed(keyBuffer);
    const publicKey = Buffer.from(keyPair.publicKey);
    const address = await createOctraAddress(publicKey);

    return {
      address,
      privateKey: bufferToBase64(keyBuffer),
      publicKey: bufferToHex(publicKey),
      type: 'imported-private-key',
    };
  } catch {
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
    type: 'imported-mnemonic',
  };
}