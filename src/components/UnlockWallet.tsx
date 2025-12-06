import React, { useState } from 'react';
import { WalletManager } from '../utils/walletManager';
import { Wallet } from '../types/wallet';
import { Shield } from 'lucide-react';

interface UnlockWalletProps {
  onUnlock: (wallets: Wallet[]) => void;
}

export function UnlockWallet({ onUnlock }: UnlockWalletProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
      setError(error.message === 'Invalid password' ? 'Invalid password' : 'Failed to unlock wallet');
    } finally {
      setIsLoading(false);
      setPassword(''); // Clear password for security
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-primary rounded-full">
            <Shield className="h-8 w-8 text-primary-foreground" />
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold">Unlock Wallet</h1>
          <p className="text-muted-foreground mt-2">
            Enter your password to access your wallets
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-3 py-2 border border-border rounded-md bg-background"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}