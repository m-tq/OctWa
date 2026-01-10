import React, { useState, useEffect } from 'react';
import { WalletManager } from '../utils/walletManager';
import { Wallet } from '../types/wallet';
import { AlertTriangle, Clock, Eye, EyeOff } from 'lucide-react';
import { ExtensionStorageManager } from '../utils/extensionStorage';

interface UnlockWalletProps {
  onUnlock: (wallets: Wallet[]) => void;
  isPopupMode?: boolean;
}

export function UnlockWallet({
  onUnlock,
  isPopupMode = false,
}: UnlockWalletProps) {
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

  // Caps Lock detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.getModifierState('CapsLock')) {
        setCapsLockOn(true);
      }
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

  // Check rate limit on mount and after each attempt
  const checkRateLimit = () => {
    const info = WalletManager.checkRateLimit();
    setRateLimitInfo(info);
    if (info.limited && info.remainingMs) {
      setCountdown(Math.ceil(info.remainingMs / 1000));
    }
  };

  useEffect(() => {
    checkRateLimit();
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
        if (countdown === 1) {
          checkRateLimit();
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check rate limit before attempting
    checkRateLimit();
    if (rateLimitInfo?.limited) {
      return;
    }

    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      console.log('🔓 UnlockWallet: Attempting to unlock...');
      const wallets = await WalletManager.unlockWallets(password);
      console.log('✅ UnlockWallet: Unlock successful, wallets:', wallets.length);

      // Simple callback - NO state management here
      onUnlock(wallets);
    } catch (error: any) {
      console.error('❌ UnlockWallet: Unlock failed:', error);

      // Check if it's a rate limit error
      if (error.message?.includes('Too many attempts')) {
        setError(error.message);
        checkRateLimit();
      } else {
        setError(
          error.message === 'Invalid password'
            ? 'Invalid password'
            : 'Failed to unlock wallet'
        );
        checkRateLimit(); // Update remaining attempts
      }
    } finally {
      setIsLoading(false);
      setPassword(''); // Clear password for security
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

    // Clear all wallet data
    localStorage.removeItem('wallets');
    localStorage.removeItem('encryptedWallets');
    localStorage.removeItem('walletPasswordHash');
    localStorage.removeItem('walletPasswordSalt');
    localStorage.removeItem('isWalletLocked');
    localStorage.removeItem('activeWalletId');
    localStorage.removeItem('unlockAttempts');
    localStorage.removeItem('lockoutUntil');
    localStorage.removeItem('walletRateLimitState');

    await ExtensionStorageManager.remove('wallets');
    await ExtensionStorageManager.remove('encryptedWallets');
    await ExtensionStorageManager.remove('walletPasswordHash');
    await ExtensionStorageManager.remove('walletPasswordSalt');
    await ExtensionStorageManager.remove('isWalletLocked');
    await ExtensionStorageManager.remove('activeWalletId');

    // Reload to show welcome screen
    window.location.reload();
  };

  // Reset Confirmation Dialog
  if (showResetConfirm) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div
          className={`w-full ${isPopupMode ? 'max-w-xs p-4 space-y-4' : 'max-w-lg p-8 space-y-6'}`}
        >
          <div className={`flex justify-center ${isPopupMode ? 'mb-3' : 'mb-6'}`}>
            <div
              className={`${isPopupMode ? 'p-2' : 'p-4'} bg-red-500 rounded-full`}
            >
              <AlertTriangle
                className={`${isPopupMode ? 'h-6 w-6' : 'h-12 w-12'} text-white`}
              />
            </div>
          </div>
          <div className="text-center">
            <h1
              className={`${isPopupMode ? 'text-xl' : 'text-3xl'} font-bold text-red-500`}
            >
              Reset Wallet
            </h1>
            <p
              className={`text-muted-foreground ${isPopupMode ? 'mt-2 text-xs' : 'mt-3 text-base'}`}
            >
              This will permanently delete all wallet data. You can only recover
              your wallet using your seed phrase or private key.
            </p>
          </div>

          <div
            className={`${isPopupMode ? 'p-3' : 'p-5'} bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800`}
          >
            <p
              className={`${isPopupMode ? 'text-xs' : 'text-base'} text-red-600 dark:text-red-400 text-center`}
            >
              Type <span className="font-bold">RESET</span> to confirm
            </p>
          </div>

          <input
            type="text"
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
            placeholder="Type RESET"
            className={`w-full ${isPopupMode ? 'px-2 py-1.5 text-sm' : 'px-4 py-3 text-lg'} border border-border bg-background text-center font-mono`}
          />

          <div className={`flex ${isPopupMode ? 'gap-2' : 'gap-4'}`}>
            <button
              onClick={() => {
                setShowResetConfirm(false);
                setResetConfirmText('');
              }}
              className={`flex-1 ${isPopupMode ? 'py-1.5 px-3 text-sm' : 'py-3 px-6 text-base'} border border-border hover:bg-accent`}
            >
              Cancel
            </button>
            <button
              onClick={handleForgotPassword}
              disabled={resetConfirmText !== 'RESET'}
              className={`flex-1 ${isPopupMode ? 'py-1.5 px-3 text-sm' : 'py-3 px-6 text-base'} bg-red-500 text-white hover:bg-red-600 disabled:opacity-50`}
            >
              Reset Wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div
        className={`w-full ${isPopupMode ? 'max-w-xs p-4 space-y-4' : 'max-w-lg p-8 space-y-6'}`}
      >
        <div className={`flex justify-center ${isPopupMode ? 'mb-3' : 'mb-6'}`}>
          {isLocked ? (
            <div className={`${isPopupMode ? 'p-2' : 'p-4'} bg-red-500`}>
              <Clock
                className={`${isPopupMode ? 'h-6 w-6' : 'h-12 w-12'} text-white`}
              />
            </div>
          ) : (
            <img
              src="/icons/octwa128x128.png"
              alt="OctWa Logo"
              className={`${isPopupMode ? 'h-12 w-12' : 'h-24 w-24'} object-contain`}
            />
          )}
        </div>
        <div className="text-center">
          <h1 className={`${isPopupMode ? 'text-xl' : 'text-3xl'} font-bold`}>
            {isLocked ? 'Temporarily Locked' : 'Unlock Wallet'}
          </h1>
          <p
            className={`text-muted-foreground ${isPopupMode ? 'mt-2 text-xs' : 'mt-3 text-base'}`}
          >
            {isLocked
              ? 'Too many failed attempts. Please wait.'
              : 'Enter your password to access your wallets'}
          </p>
        </div>

        {/* Lockout Timer */}
        {isLocked && (
          <div
            className={`flex flex-col items-center gap-2 ${isPopupMode ? 'p-3' : 'p-6'} bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800`}
          >
            <AlertTriangle
              className={`${isPopupMode ? 'h-5 w-5' : 'h-8 w-8'} text-red-500`}
            />
            <div className="text-center">
              <p
                className={`${isPopupMode ? 'text-xs' : 'text-base'} text-red-600 dark:text-red-400`}
              >
                Try again in
              </p>
              <p
                className={`${isPopupMode ? 'text-xl' : 'text-4xl'} font-mono font-bold text-red-600 dark:text-red-400`}
              >
                {formatTime(countdown)}
              </p>
            </div>
          </div>
        )}

        <form
          onSubmit={handleUnlock}
          className={isPopupMode ? 'space-y-3' : 'space-y-5'}
        >
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className={`w-full ${isPopupMode ? 'px-2 py-1.5 pr-8 text-sm' : 'px-4 py-3 pr-12 text-lg'} border border-border bg-background disabled:opacity-50`}
              disabled={isLoading || isLocked}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className={`absolute right-0 top-0 h-full ${isPopupMode ? 'px-2' : 'px-4'} text-muted-foreground hover:text-foreground disabled:opacity-50`}
              disabled={isLoading || isLocked}
            >
              {showPassword ? (
                <EyeOff className={`${isPopupMode ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
              ) : (
                <Eye className={`${isPopupMode ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
              )}
            </button>
          </div>

          {/* Caps Lock Warning */}
          {capsLockOn && !isLocked && (
            <div
              className={`flex items-center gap-2 ${isPopupMode ? 'p-1.5' : 'p-3'} bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400`}
            >
              <AlertTriangle
                className={`${isPopupMode ? 'h-3 w-3' : 'h-5 w-5'} flex-shrink-0`}
              />
              <span className={`${isPopupMode ? 'text-[10px]' : 'text-sm'}`}>
                Caps Lock is ON
              </span>
            </div>
          )}

          {/* Remaining Attempts Warning */}
          {!isLocked &&
            rateLimitInfo &&
            rateLimitInfo.remainingAttempts < 5 &&
            rateLimitInfo.remainingAttempts > 0 && (
              <div
                className={`flex items-center gap-2 text-yellow-600 dark:text-yellow-400 ${isPopupMode ? 'text-xs' : 'text-sm'}`}
              >
                <AlertTriangle
                  className={`${isPopupMode ? 'h-3 w-3' : 'h-5 w-5'}`}
                />
                <span>
                  {rateLimitInfo.remainingAttempts} attempt(s) remaining before
                  lockout
                </span>
              </div>
            )}

          {error && !isLocked && (
            <div
              className={`text-red-500 ${isPopupMode ? 'text-xs' : 'text-base'} text-center`}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isLocked}
            className={`w-full ${isPopupMode ? 'py-1.5 text-sm' : 'py-3 px-6 text-lg font-medium'} bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50`}
          >
            {isLoading ? 'Unlocking...' : isLocked ? 'Locked' : 'Unlock'}
          </button>
        </form>

        {/* Forgot Password */}
        <button
          onClick={() => setShowResetConfirm(true)}
          className={`w-full ${isPopupMode ? 'text-xs' : 'text-base'} text-muted-foreground hover:text-foreground transition-colors`}
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}
