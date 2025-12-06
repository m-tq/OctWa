import { Buffer } from 'buffer';

export async function hashPassword(password: string, salt?: string): Promise<{ hashedPassword: string; salt: string }> {
  const encoder = new TextEncoder();
  const saltBytes = salt ? Buffer.from(salt, 'hex') : crypto.getRandomValues(new Uint8Array(16));
  
  const passwordBytes = encoder.encode(password);
  const combined = new Uint8Array(passwordBytes.length + saltBytes.length);
  combined.set(passwordBytes);
  combined.set(saltBytes, passwordBytes.length);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashedPassword = Buffer.from(hashBuffer).toString('hex');
  
  return {
    hashedPassword,
    salt: Buffer.from(saltBytes).toString('hex')
  };
}

export async function verifyPassword(password: string, hashedPassword: string, salt: string): Promise<boolean> {
  const { hashedPassword: newHash } = await hashPassword(password, salt);
  return newHash === hashedPassword;
}

export function encryptWalletData(data: string, password: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        await crypto.subtle.digest('SHA-256', encoder.encode(password)),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );
      
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(data)
      );
      
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      resolve(Buffer.from(combined).toString('base64'));
    } catch (error) {
      reject(error);
    }
  });
}

export function decryptWalletData(encryptedData: string, password: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      
      const key = await crypto.subtle.importKey(
        'raw',
        await crypto.subtle.digest('SHA-256', encoder.encode(password)),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      
      const combined = Buffer.from(encryptedData, 'base64');
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      );
      
      resolve(decoder.decode(decrypted));
    } catch (error) {
      reject(error);
    }
  });
}