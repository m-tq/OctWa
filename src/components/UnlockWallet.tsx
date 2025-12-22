import React, { useState, useEffect } from 'react';
import { WalletManager } from '../utils/walletManager';
import { Wallet } from '../types/wallet';
import { Shield, AlertTriangle, Clock } from 'lucide-react';

interface UnlockWalletProps {
  onUnlock: (wallets: Wallet[]) => void;
}

export function UnlockWallet({ onUnlock }: UnlockWalletProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    limited: boolean;
    remainingMs?: number;
    remainingAttempts: number;
  } | null>(null);
  const [countdown, setCountdown] = useState(0);

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
        setError(error.message === 'Invalid password' ? 'Invalid password' : 'Failed to unlock wallet');
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

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="flex justify-center mb-4">
          <div className={`p-3 rounded-full ${isLocked ? 'bg-red-500' : 'bg-primary'}`}>
            {isLocked ? (
              <Clock className="h-8 w-8 text-white" />
            ) : (
              <Shield className="h-8 w-8 text-primary-foreground" />
            )}
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            {isLocked ? 'Temporarily Locked' : 'Unlock Wallet'}
          </h1>
          <p className="text-muted-foreground mt-2">
            {isLocked 
              ? 'Too many failed attempts. Please wait.'
              : 'Enter your password to access your wallets'
            }
          </p>
        </div>

        {/* Lockout Timer */}
        {isLocked && (
          <div className="flex flex-col items-center gap-2 p-4 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
            <AlertTriangle className="h-6 w-6 text-red-500" />
            <div className="text-center">
              <p className="text-sm text-red-600 dark:text-red-400">
                Try again in
              </p>
              <p className="text-2xl font-mono font-bold text-red-600 dark:text-red-400">
                {formatTime(countdown)}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-3 py-2 border border-border rounded-md bg-background disabled:opacity-50"
              disabled={isLoading || isLocked}
            />
          </div>

          {/* Remaining Attempts Warning */}
          {!isLocked && rateLimitInfo && rateLimitInfo.remainingAttempts < 5 && rateLimitInfo.remainingAttempts > 0 && (
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>{rateLimitInfo.remainingAttempts} attempt(s) remaining before lockout</span>
            </div>
          )}

          {error && !isLocked && (
            <div className="text-red-500 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isLocked}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? 'Unlocking...' : isLocked ? 'Locked' : 'Unlock'}
          </button>
        </form>

        {/* Security Info */}
        <p className="text-xs text-center text-muted-foreground">
          Your wallet is protected with AES-256 encryption
        </p>
      </div>
    </div>
  );
}
