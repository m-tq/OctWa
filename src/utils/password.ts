import { Buffer } from 'buffer';

// Security constants — OWASP-recommended values for AES-256-GCM + PBKDF2-SHA256.
const PBKDF2_ITERATIONS = 310_000;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SESSION_KEY_LENGTH = 32;

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
const RATE_LIMIT_STORAGE_KEY = 'walletRateLimitState';

interface RateLimitState {
  attempts: number;
  lastAttempt: number;
  lockedUntil: number | null;
}

function loadRateLimitState(): RateLimitState {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        attempts: parsed.attempts || 0,
        lastAttempt: parsed.lastAttempt || 0,
        lockedUntil: parsed.lockedUntil || null,
      };
    }
  } catch (e) {
    console.error('Failed to load rate limit state:', e);
  }
  return { attempts: 0, lastAttempt: 0, lockedUntil: null };
}

function saveRateLimitState(state: RateLimitState): void {
  try {
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save rate limit state:', e);
  }
}

let rateLimitState: RateLimitState = loadRateLimitState();

export function isRateLimited(): { limited: boolean; remainingMs?: number } {
  rateLimitState = loadRateLimitState();
  const now = Date.now();

  if (rateLimitState.lockedUntil && now < rateLimitState.lockedUntil) {
    return { limited: true, remainingMs: rateLimitState.lockedUntil - now };
  }

  if (rateLimitState.lockedUntil && now >= rateLimitState.lockedUntil) {
    rateLimitState = { attempts: 0, lastAttempt: 0, lockedUntil: null };
    saveRateLimitState(rateLimitState);
  }

  return { limited: false };
}

export function recordFailedAttempt(): void {
  rateLimitState = loadRateLimitState();
  const now = Date.now();

  if (now - rateLimitState.lastAttempt > LOCKOUT_DURATION_MS) {
    rateLimitState.attempts = 0;
  }

  rateLimitState.attempts++;
  rateLimitState.lastAttempt = now;

  if (rateLimitState.attempts >= MAX_ATTEMPTS) {
    rateLimitState.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`Too many failed attempts. Locked for ${LOCKOUT_DURATION_MS / 1000} seconds`);
  }

  saveRateLimitState(rateLimitState);
}

export function resetRateLimit(): void {
  rateLimitState = { attempts: 0, lastAttempt: 0, lockedUntil: null };
  saveRateLimitState(rateLimitState);
}

export function getRemainingAttempts(): number {
  rateLimitState = loadRateLimitState();
  return Math.max(0, MAX_ATTEMPTS - rateLimitState.attempts);
}

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt).buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export async function hashPassword(
  password: string,
  salt?: string,
): Promise<{ hashedPassword: string; salt: string }> {
  const saltBytes = salt
    ? Buffer.from(salt, 'hex')
    : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    KEY_LENGTH * 8,
  );

  return {
    hashedPassword: Buffer.from(hashBuffer).toString('hex'),
    salt: Buffer.from(saltBytes).toString('hex'),
  };
}

export async function verifyPassword(
  password: string,
  hashedPassword: string,
  salt: string,
): Promise<boolean> {
  const rateLimit = isRateLimited();
  if (rateLimit.limited) {
    throw new Error(
      `Too many attempts. Try again in ${Math.ceil((rateLimit.remainingMs ?? 0) / 1000)} seconds`,
    );
  }

  const { hashedPassword: newHash } = await hashPassword(password, salt);
  const isValid = timingSafeEqual(newHash, hashedPassword);

  if (isValid) {
    resetRateLimit();
  } else {
    recordFailedAttempt();
  }

  return isValid;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export async function encryptWalletData(data: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt, ['encrypt']);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(data),
  );

  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return Buffer.from(combined).toString('base64');
}

export async function decryptWalletData(encryptedData: string, password: string): Promise<string> {
  const combined = Buffer.from(encryptedData, 'base64');

  if (combined.length < SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error('Invalid encrypted data format');
  }

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt, ['decrypt']);

  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('Decryption failed - invalid password or corrupted data');
  }
}

export function secureWipe(data: string | Uint8Array | ArrayBuffer): void {
  if (typeof data === 'string') return; // Strings are immutable in JS

  if (data instanceof ArrayBuffer) {
    const view = new Uint8Array(data);
    crypto.getRandomValues(view);
    view.fill(0);
  } else if (data instanceof Uint8Array) {
    crypto.getRandomValues(data);
    data.fill(0);
  }
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  if (password.length < 8) {
    feedback.push('Password must be at least 8 characters');
  } else {
    score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
  }

  if (/[a-z]/.test(password)) score += 1; else feedback.push('Add lowercase letters');
  if (/[A-Z]/.test(password)) score += 1; else feedback.push('Add uppercase letters');
  if (/[0-9]/.test(password)) score += 1;  else feedback.push('Add numbers');
  if (/[^a-zA-Z0-9]/.test(password)) score += 1; else feedback.push('Add special characters');

  const commonPatterns = [
    /^123456/,
    /^password/i,
    /^qwerty/i,
    /^abc123/i,
    /(.)\1{3,}/,
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score = Math.max(0, score - 2);
      feedback.push('Avoid common patterns');
      break;
    }
  }

  return {
    valid: password.length >= 8 && score >= 4,
    score: Math.min(score, 7),
    feedback,
  };
}


// ============================================
// SESSION ENCRYPTION UTILITIES
// ============================================

export function generateSessionKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(SESSION_KEY_LENGTH))).toString('base64');
}

export async function encryptSessionData(data: string, sessionKey: string): Promise<string> {
  const keyBytes = Buffer.from(sessionKey, 'base64');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(data),
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(combined).toString('base64');
}

export async function decryptSessionData(encryptedData: string, sessionKey: string): Promise<string> {
  const combined = Buffer.from(encryptedData, 'base64');

  if (combined.length < IV_LENGTH + 16) {
    throw new Error('Invalid encrypted session data format');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const keyBytes = Buffer.from(sessionKey, 'base64');

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('Session decryption failed - invalid key or corrupted data');
  }
}
