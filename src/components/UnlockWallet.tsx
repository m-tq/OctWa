import React, { useState, useEffect } from 'react';
import { WalletManager } from '../utils/walletManager';
import { Wallet } from '../types/wallet';
import { AlertTriangle, Clock, Eye, EyeOff } from 'lucide-react';
import { ExtensionStorageManager } from '../utils/extensionStorage';
import { resetModeSwitchReminder } from './ModeSwitchConfirmDialog';
import { resetOnboardingState } from './OnboardingOverlay';

interface UnlockWalletProps {
  onUnlock: (wallets: Wallet[]) => void;
  isPopupMode?: boolean;
}

export function UnlockWallet({ onUnlock, isPopupMode = false }: UnlockWalletProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    limited: boolean;
    remainingMs?: number;
    remainingAttempts: number;
  } | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setCapsLockOn(e.getModifierState('CapsLock'));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      setCapsLockOn(e.getModifierState('CapsLock'));
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const checkRateLimit = () => {
    const info = WalletManager.checkRateLimit();
    setRateLimitInfo(info);
    if (info.limited && info.remainingMs) {
      setCountdown(Math.ceil(info.remainingMs / 1000));
    }
  };

  useEffect(() => { checkRateLimit(); }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
        if (countdown === 1) checkRateLimit();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateInfo = WalletManager.checkRateLimit();
    setRateLimitInfo(rateInfo);
    if (rateInfo.limited) {
      if (rateInfo.remainingMs) setCountdown(Math.ceil(rateInfo.remainingMs / 1000));
      return;
    }
    if (!password.trim()) {
      setError('password is required');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const wallets = await WalletManager.unlockWallets(password);
      onUnlock(wallets);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Too many attempts')) {
        setError(message);
        checkRateLimit();
      } else {
        setError(message === 'Invalid password' ? 'invalid password' : 'failed to unlock wallet');
        checkRateLimit();
      }
    } finally {
      setIsLoading(false);
      setPassword('');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isLocked = rateLimitInfo?.limited && countdown > 0;

  const handleForgotPassword = async () => {
    if (resetConfirmText !== 'RESET') return;
    const keys = [
      'wallets', 'encryptedWallets', 'walletPasswordHash', 'walletPasswordSalt',
      'isWalletLocked', 'activeWalletId', 'unlockAttempts', 'lockoutUntil',
      'walletRateLimitState',
    ];
    keys.forEach(k => localStorage.removeItem(k));
    await Promise.all([
      ExtensionStorageManager.remove('wallets'),
      ExtensionStorageManager.remove('encryptedWallets'),
      ExtensionStorageManager.remove('walletPasswordHash'),
      ExtensionStorageManager.remove('walletPasswordSalt'),
      ExtensionStorageManager.remove('isWalletLocked'),
      ExtensionStorageManager.remove('activeWalletId'),
    ]);
    resetModeSwitchReminder();
    resetOnboardingState();
    window.location.reload();
  };

  // ── Reset confirmation screen ──
  if (showResetConfirm) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className={`w-full ${isPopupMode ? 'max-w-xs p-4 space-y-4' : 'max-w-md p-8 space-y-5'}`}>

          {/* Danger icon */}
          <div className="flex justify-center">
            <div className={`${isPopupMode ? 'p-2' : 'p-3'} bg-oc-danger`}>
              <AlertTriangle className={`${isPopupMode ? 'h-5 w-5' : 'h-8 w-8'} text-white`} />
            </div>
          </div>

          {/* Title */}
          <div className="text-center">
            <div
              className="font-bold text-oc-danger"
              style={{ fontSize: isPopupMode ? 'var(--oct-type-size-03)' : '1.25rem' }}
            >
              reset wallet
            </div>
            <p
              className="text-muted-foreground mt-2"
              style={{ fontSize: 'var(--oct-type-size-02)' }}
            >
              this will permanently delete all wallet data. you can only recover
              your wallet using your seed phrase or private key.
            </p>
          </div>

          {/* Warning box */}
          <div
            className="px-3 py-2 border border-oc-danger"
            style={{ background: 'var(--oct-color-danger-bg)' }}
          >
            <p
              className="text-oc-danger text-center"
              style={{ fontSize: 'var(--oct-type-size-02)' }}
            >
              type <span className="font-bold font-mono">RESET</span> to confirm
            </p>
          </div>

          <input
            type="text"
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
            placeholder="type RESET"
            className="octra-input text-center font-mono"
            aria-label="Type RESET to confirm wallet reset"
          />

          <div className="flex gap-2">
            <button
              onClick={() => { setShowResetConfirm(false); setResetConfirmText(''); }}
              className="flex-1 py-1.5 px-3 border border-oc-border hover:bg-accent"
              style={{ fontSize: 'var(--oct-type-size-02)' }}
            >
              cancel
            </button>
            <button
              onClick={handleForgotPassword}
              disabled={resetConfirmText !== 'RESET'}
              className="flex-1 py-1.5 px-3 bg-oc-danger text-white hover:bg-oc-danger/85 disabled:opacity-50"
              style={{ fontSize: 'var(--oct-type-size-02)' }}
            >
              reset wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Unlock screen ──
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className={`w-full ${isPopupMode ? 'max-w-xs p-4 space-y-4' : 'max-w-md p-8 space-y-5'}`}>

        {/* Logo / locked icon */}
        <div className="flex justify-center">
          {isLocked ? (
            <div className={`${isPopupMode ? 'p-2' : 'p-3'} bg-oc-danger`}>
              <Clock className={`${isPopupMode ? 'h-5 w-5' : 'h-8 w-8'} text-white`} />
            </div>
          ) : (
            <svg
              viewBox="0 0 50 50"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width={isPopupMode ? 48 : 72}
              height={isPopupMode ? 48 : 72}
              role="img"
              aria-label="OctWa Logo"
            >
              <circle cx="25" cy="25" r="21" stroke="#3B567F" strokeWidth="8" fill="none" />
              <circle cx="25" cy="25" r="9" fill="#3B567F" />
            </svg>
          )}
        </div>

        {/* Title */}
        <div className="text-center">
          <div
            className="font-bold text-foreground"
            style={{ fontSize: isPopupMode ? 'var(--oct-type-size-03)' : '1.1rem' }}
          >
            {isLocked ? 'temporarily locked' : 'unlock wallet'}
          </div>
          <p
            className="text-muted-foreground mt-1"
            style={{ fontSize: 'var(--oct-type-size-02)' }}
          >
            {isLocked
              ? 'too many failed attempts. please wait.'
              : 'enter your password to access your wallets'}
          </p>
        </div>

        {/* Lockout timer */}
        {isLocked && (
          <div
            className="flex flex-col items-center gap-2 px-3 py-4 border border-oc-danger"
            style={{ background: 'var(--oct-color-danger-bg)' }}
          >
            <AlertTriangle className="h-5 w-5 text-oc-danger" />
            <div className="text-center">
              <p className="text-oc-danger" style={{ fontSize: 'var(--oct-type-size-02)' }}>
                try again in
              </p>
              <p
                className="font-mono font-bold text-oc-danger"
                style={{ fontSize: isPopupMode ? '1.5rem' : '2rem' }}
              >
                {formatTime(countdown)}
              </p>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleUnlock} className="space-y-3">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="enter password"
              className="octra-input pr-10"
              disabled={isLoading || isLocked}
              aria-label="Wallet password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 h-full px-2.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={isLoading || isLocked}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword
                ? <EyeOff className="h-3.5 w-3.5" />
                : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Caps lock warning */}
          {capsLockOn && !isLocked && (
            <div
              className="flex items-center gap-2 px-2 py-1.5 border"
              style={{
                background: 'var(--oct-color-warning-bg)',
                borderColor: 'hsl(var(--oc-warning))',
                color: 'hsl(var(--oc-warning))',
                fontSize: 'var(--oct-type-size-02)',
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>caps lock is on</span>
            </div>
          )}

          {/* Remaining attempts warning */}
          {!isLocked && rateLimitInfo && rateLimitInfo.remainingAttempts < 5 && rateLimitInfo.remainingAttempts > 0 && (
            <div
              className="flex items-center gap-2"
              style={{ color: 'hsl(var(--oc-warning))', fontSize: 'var(--oct-type-size-02)' }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{rateLimitInfo.remainingAttempts} attempt(s) remaining before lockout</span>
            </div>
          )}

          {/* Error */}
          {error && !isLocked && (
            <div
              className="text-center"
              style={{ color: 'hsl(var(--oc-danger))', fontSize: 'var(--oct-type-size-02)' }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isLocked}
            className="w-full py-2 bg-primary text-primary-foreground hover:bg-primary/85 disabled:opacity-50 font-bold"
            style={{ fontSize: 'var(--oct-type-size-02)' }}
          >
            {isLoading ? 'unlocking...' : isLocked ? 'locked' : 'unlock'}
          </button>
        </form>

        {/* Forgot password */}
        <button
          onClick={() => setShowResetConfirm(true)}
          className="w-full text-center text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontSize: 'var(--oct-type-size-02)' }}
        >
          forgot password?
        </button>
      </div>
    </div>
  );
}
