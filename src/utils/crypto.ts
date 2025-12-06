import * as bip39 from 'bip39';
import * as nacl from 'tweetnacl';

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString("hex");
}

export function bufferToBase64(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString("base64");
}

export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

export function base58Encode(buffer: Buffer): string {
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

export async function deriveMasterKey(seed: Buffer) {
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

export function mnemonicToSeed(mnemonic: string): Buffer {
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

// New encryption functions for private balance
export function deriveEncryptionKey(privkeyB64: string): Uint8Array {
  const privkeyBytes = base64ToBuffer(privkeyB64);
  const salt = new TextEncoder().encode("octra_encrypted_balance_v2");
  
  // Create a combined buffer
  const combined = new Uint8Array(salt.length + privkeyBytes.length);
  combined.set(salt);
  combined.set(privkeyBytes, salt.length);
  
  // Use crypto.subtle.digest to create SHA-256 hash
  return crypto.subtle.digest('SHA-256', combined).then(hash => {
    return new Uint8Array(hash).slice(0, 32);
  }) as any; // This will be awaited where used
}

export async function encryptClientBalance(balance: number, privkeyB64: string): Promise<string> {
  const key = await deriveEncryptionKey(privkeyB64);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(balance.toString());
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    plaintext
  );
  
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(ciphertext), nonce.length);
  
  return "v2|" + bufferToBase64(Buffer.from(combined));
}

export async function decryptClientBalance(encryptedData: string, privkeyB64: string): Promise<number> {
  if (encryptedData === "0" || !encryptedData) {
    return 0;
  }
  
  if (!encryptedData.startsWith("v2|")) {
    // Handle v1 format (legacy)
    return 0; // For now, return 0 for v1 format
  }
  
  try {
    const b64Data = encryptedData.slice(3);
    const raw = base64ToBuffer(b64Data);
    
    if (raw.length < 28) {
      return 0;
    }
    
    const nonce = raw.slice(0, 12);
    const ciphertext = raw.slice(12);
    
    const key = await deriveEncryptionKey(privkeyB64);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      cryptoKey,
      ciphertext
    );
    
    return parseInt(new TextDecoder().decode(plaintext));
  } catch {
    return 0;
  }
}

// Functions for private transfers
export async function deriveSharedSecretForClaim(myPrivkeyB64: string, ephemeralPubkeyB64: string): Promise<Uint8Array> {
  const sk = nacl.sign.keyPair.fromSecretKey(base64ToBuffer(myPrivkeyB64 + '='.repeat(4 - myPrivkeyB64.length % 4)));
  const myPubkeyBytes = sk.publicKey;
  const ephPubBytes = base64ToBuffer(ephemeralPubkeyB64);
  
  let smaller: Uint8Array, larger: Uint8Array;
  
  // Compare bytes to determine order
  const comparison = Buffer.compare(Buffer.from(ephPubBytes), Buffer.from(myPubkeyBytes));
  if (comparison < 0) {
    smaller = ephPubBytes;
    larger = myPubkeyBytes;
  } else {
    smaller = myPubkeyBytes;
    larger = ephPubBytes;
  }
  
  const combined = new Uint8Array(smaller.length + larger.length);
  combined.set(smaller);
  combined.set(larger, smaller.length);
  
  const round1 = await crypto.subtle.digest('SHA-256', combined);
  const round1Array = new Uint8Array(round1);
  
  const suffix = new TextEncoder().encode("OCTRA_SYMMETRIC_V1");
  const round2Input = new Uint8Array(round1Array.length + suffix.length);
  round2Input.set(round1Array);
  round2Input.set(suffix, round1Array.length);
  
  const round2 = await crypto.subtle.digest('SHA-256', round2Input);
  return new Uint8Array(round2).slice(0, 32);
}

export async function decryptPrivateAmount(encryptedData: string, sharedSecret: Uint8Array): Promise<number | null> {
  if (!encryptedData || !encryptedData.startsWith("v2|")) {
    return null;
  }
  
  try {
    const raw = base64ToBuffer(encryptedData.slice(3));
    if (raw.length < 28) {
      return null;
    }
    
    const nonce = raw.slice(0, 12);
    const ciphertext = raw.slice(12);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      cryptoKey,
      ciphertext
    );
    
    return parseInt(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}