import { Buffer } from 'buffer';

// Security constants
const PBKDF2_ITERATIONS = 310000; // OWASP recommendation for SHA-256
const SALT_LENGTH = 32; // 256 bits
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // 96 bits for AES-GCM
const SESSION_KEY_LENGTH = 32; // 256 bits for session encryption

// Rate limiting for password attempts
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_STORAGE_KEY = 'walletRateLimitState';

interface RateLimitState {
  attempts: number;
  lastAttempt: number;
  lockedUntil: number | null;
}

// Load rate limit state from localStorage
function loadRateLimitState(): RateLimitState {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        attempts: parsed.attempts || 0,
        lastAttempt: parsed.lastAttempt || 0,
        lockedUntil: parsed.lockedUntil || null
      };
    }
  } catch (e) {
    console.error('Failed to load rate limit state:', e);
  }
  return { attempts: 0, lastAttempt: 0, lockedUntil: null };
}

// Save rate limit state to localStorage
function saveRateLimitState(state: RateLimitState): void {
  try {
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save rate limit state:', e);
  }
}

let rateLimitState: RateLimitState = loadRateLimitState();

// Check if rate limited
export function isRateLimited(): { limited: boolean; remainingMs?: number } {
  // Reload state from storage to ensure we have latest
  rateLimitState = loadRateLimitState();
  const now = Date.now();
  
  // Check if currently locked out
  if (rateLimitState.lockedUntil && now < rateLimitState.lockedUntil) {
    return { 
      limited: true, 
      remainingMs: rateLimitState.lockedUntil - now 
    };
  }
  
  // Reset if lockout expired
  if (rateLimitState.lockedUntil && now >= rateLimitState.lockedUntil) {
    rateLimitState = { attempts: 0, lastAttempt: 0, lockedUntil: null };
    saveRateLimitState(rateLimitState);
  }
  
  return { limited: false };
}

// Record a failed attempt
export function recordFailedAttempt(): void {
  // Reload state from storage first
  rateLimitState = loadRateLimitState();
  const now = Date.now();
  
  // Reset attempts if last attempt was more than lockout duration ago
  if (now - rateLimitState.lastAttempt > LOCKOUT_DURATION_MS) {
    rateLimitState.attempts = 0;
  }
  
  rateLimitState.attempts++;
  rateLimitState.lastAttempt = now;
  
  // Lock out if max attempts exceeded
  if (rateLimitState.attempts >= MAX_ATTEMPTS) {
    rateLimitState.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`🔒 Too many failed attempts. Locked for ${LOCKOUT_DURATION_MS / 1000} seconds`);
  }
  
  // Save state to localStorage
  saveRateLimitState(rateLimitState);
}

// Reset rate limit on successful login
export function resetRateLimit(): void {
  rateLimitState = { attempts: 0, lastAttempt: 0, lockedUntil: null };
  saveRateLimitState(rateLimitState);
}

// Get remaining attempts
export function getRemainingAttempts(): number {
  // Reload state from storage
  rateLimitState = loadRateLimitState();
  return Math.max(0, MAX_ATTEMPTS - rateLimitState.attempts);
}

// Derive key using PBKDF2 with proper parameters
async function deriveKey(
  password: string, 
  salt: Uint8Array, 
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  // Create a new ArrayBuffer copy to satisfy TypeScript
  const saltCopy = new Uint8Array(salt).buffer as ArrayBuffer;
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltCopy,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

// Hash password using PBKDF2
export async function hashPassword(
  password: string, 
  salt?: string
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
    ['deriveBits']
  );
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordKey,
    KEY_LENGTH * 8 // bits
  );
  
  return {
    hashedPassword: Buffer.from(hashBuffer).toString('hex'),
    salt: Buffer.from(saltBytes).toString('hex')
  };
}

// Verify password with timing-safe comparison
export async function verifyPassword(
  password: string, 
  hashedPassword: string, 
  salt: string
): Promise<boolean> {
  // Check rate limit first
  const rateLimit = isRateLimited();
  if (rateLimit.limited) {
    throw new Error(`Too many attempts. Try again in ${Math.ceil((rateLimit.remainingMs || 0) / 1000)} seconds`);
  }
  
  const { hashedPassword: newHash } = await hashPassword(password, salt);
  
  // Timing-safe comparison to prevent timing attacks
  const isValid = timingSafeEqual(newHash, hashedPassword);
  
  if (!isValid) {
    recordFailedAttempt();
  } else {
    resetRateLimit();
  }
  
  return isValid;
}

// Timing-safe string comparison
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

// Encrypt wallet data using AES-GCM
export async function encryptWalletData(data: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  const key = await deriveKey(password, salt, ['encrypt']);
  
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );
  
  // Format: salt (32) + iv (12) + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  
  return Buffer.from(combined).toString('base64');
}

// Decrypt wallet data using AES-GCM
export async function decryptWalletData(encryptedData: string, password: string): Promise<string> {
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Check minimum length (salt + iv + at least some ciphertext)
  if (combined.length < SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error('Invalid encrypted data format');
  }
  
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
  
  const key = await deriveKey(password, salt, ['decrypt']);
  
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    throw new Error('Decryption failed - invalid password or corrupted data');
  }
}

// Secure memory clearing utility
export function secureWipe(data: string | Uint8Array | ArrayBuffer): void {
  if (typeof data === 'string') {
    // Strings are immutable in JS, but we can try to help GC
    // by dereferencing
    return;
  }
  
  if (data instanceof ArrayBuffer) {
    const view = new Uint8Array(data);
    crypto.getRandomValues(view); // Overwrite with random data
    view.fill(0); // Then zero out
  } else if (data instanceof Uint8Array) {
    crypto.getRandomValues(data);
    data.fill(0);
  }
}

// Create a secure password validator
export function validatePasswordStrength(password: string): {
  valid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;
  
  // Minimum length
  if (password.length < 8) {
    feedback.push('Password must be at least 8 characters');
  } else {
    score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
  }
  
  // Character variety
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push('Add lowercase letters');
  
  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push('Add uppercase letters');
  
  if (/[0-9]/.test(password)) score += 1;
  else feedback.push('Add numbers');
  
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  else feedback.push('Add special characters');
  
  // Common patterns to avoid
  const commonPatterns = [
    /^123456/,
    /^password/i,
    /^qwerty/i,
    /^abc123/i,
    /(.)\1{3,}/ // Repeated characters
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
    score: Math.min(score, 7), // Max score of 7
    feedback
  };
}


// ============================================
// SESSION ENCRYPTION UTILITIES
// ============================================

// Generate a random session key (stored in memory only)
export function generateSessionKey(): string {
  const keyBytes = crypto.getRandomValues(new Uint8Array(SESSION_KEY_LENGTH));
  return Buffer.from(keyBytes).toString('base64');
}

// Encrypt data with session key (fast, for session storage)
export async function encryptSessionData(data: string, sessionKey: string): Promise<string> {
  const keyBytes = Buffer.from(sessionKey, 'base64');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoder.encode(data)
  );
  
  // Format: iv (12) + ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return Buffer.from(combined).toString('base64');
}

// Decrypt data with session key
export async function decryptSessionData(encryptedData: string, sessionKey: string): Promise<string> {
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Check minimum length (iv + at least some ciphertext)
  if (combined.length < IV_LENGTH + 16) {
    throw new Error('Invalid encrypted session data format');
  }
  
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  
  const keyBytes = Buffer.from(sessionKey, 'base64');
  
  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    throw new Error('Session decryption failed - invalid key or corrupted data');
  }
}
