import * as bip39 from 'bip39';
import * as nacl from 'tweetnacl';

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString("hex");
}

export function bufferToBase64(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString("base64");
}

function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

function base58Encode(buffer: Buffer): string {
  if (buffer.length === 0) return "";

  let num = BigInt("0x" + buffer.toString("hex"));
  let encoded = "";

  while (num > 0n) {
    const remainder = num % 58n;
    num = num / 58n;
    encoded = BASE58_ALPHABET[Number(remainder)] + encoded;
  }

  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    encoded = "1" + encoded;
  }

  return encoded;
}

export async function createOctraAddress(publicKey: Buffer): Promise<string> {
  const hash = Buffer.from(
    await crypto.subtle.digest('SHA-256', publicKey)
  );
  const base58Hash = base58Encode(hash);
  return "oct" + base58Hash;
}

async function deriveMasterKey(seed: Buffer) {
  const key = Buffer.from("Octra seed", "utf8");
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, seed);
  const macBuffer = Buffer.from(mac);
  
  return {
    masterPrivateKey: macBuffer.slice(0, 32),
    masterChainCode: macBuffer.slice(32, 64)
  };
}

export function generateMnemonic(): string {
  return bip39.generateMnemonic();
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

function mnemonicToSeed(mnemonic: string): Buffer {
  return bip39.mnemonicToSeedSync(mnemonic);
}

export async function generateWalletFromMnemonic(mnemonic: string) {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeed(mnemonic);
  const { masterPrivateKey } = await deriveMasterKey(seed);
  
  const keyPair = nacl.sign.keyPair.fromSeed(masterPrivateKey);
  const privateKey = Buffer.from(keyPair.secretKey.slice(0, 32));
  const publicKey = Buffer.from(keyPair.publicKey);
  const address = await createOctraAddress(publicKey);

  return {
    mnemonic,
    privateKey: bufferToBase64(privateKey),
    publicKey: bufferToHex(publicKey),
    address,
    balance: 0,
    nonce: 0
  };
}

export async function deriveEncryptionKey(privkeyB64: string): Promise<Uint8Array> {
  const privkeyBytes = base64ToBuffer(privkeyB64);
  const salt = new TextEncoder().encode("octra_encrypted_balance_v2");
  
  // Create a combined buffer
  const combined = new Uint8Array(salt.length + privkeyBytes.length);
  combined.set(salt);
  combined.set(privkeyBytes, salt.length);
  
  // Use crypto.subtle.digest to create SHA-256 hash
  const hash = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hash).slice(0, 32);
}