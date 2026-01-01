import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Shield, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { hashPassword, encryptWalletData } from '../utils/password';
import { useToast } from '@/hooks/use-toast';
import { ExtensionStorageManager } from '../utils/extensionStorage';
import { WalletManager } from '../utils/walletManager';

interface PasswordSetupProps {
  wallet: Wallet;
  onPasswordSet: (wallet: Wallet) => void;
  onBack: () => void;
}

export function PasswordSetup({ wallet, onPasswordSet, onBack }: PasswordSetupProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const { toast } = useToast();

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

  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: '', color: '' };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500' };
    if (score <= 3) return { score, label: 'Fair', color: 'bg-yellow-500' };
    if (score <= 4) return { score, label: 'Good', color: 'bg-blue-500' };
    return { score, label: 'Strong', color: 'bg-green-500' };
  }, [password]);

  const isValid = password.length >= 8 && password === confirmPassword && acknowledged;

  const handleCreatePassword = async () => {
    if (password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!acknowledged) {
      toast({ title: "Error", description: "Please acknowledge the warning", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      const { hashedPassword, salt } = await hashPassword(password);
      
      // Get existing encrypted wallets (if any)
      const existingEncryptedData = localStorage.getItem('encryptedWallets');
      let encryptedWallets: any[] = existingEncryptedData ? JSON.parse(existingEncryptedData) : [];
      
      // Check if wallet already exists in encrypted storage
      const walletExists = encryptedWallets.some((w: any) => w.address === wallet.address);
      
      if (!walletExists) {
        // Encrypt and add the new wallet
        const walletData = JSON.stringify(wallet);
        const encryptedWalletData = await encryptWalletData(walletData, password);
        encryptedWallets.push({ 
          address: wallet.address, 
          encryptedData: encryptedWalletData, 
          createdAt: Date.now() 
        });
      }

      console.log('🔐 PasswordSetup: Saving wallet data...');
      
      // Store password hash and salt - localStorage FIRST (synchronous, reliable)
      localStorage.setItem('walletPasswordHash', hashedPassword);
      localStorage.setItem('walletPasswordSalt', salt);
      localStorage.setItem('isWalletLocked', 'false');
      localStorage.setItem('encryptedWallets', JSON.stringify(encryptedWallets));
      localStorage.setItem('activeWalletId', wallet.address);
      
      console.log('🔐 PasswordSetup: localStorage saved, now saving to ExtensionStorage...');
      
      // Then save to ExtensionStorage (async)
      await ExtensionStorageManager.set('walletPasswordHash', hashedPassword);
      await ExtensionStorageManager.set('walletPasswordSalt', salt);
      await ExtensionStorageManager.set('isWalletLocked', 'false');
      await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(encryptedWallets));
      await ExtensionStorageManager.set('activeWalletId', wallet.address);
      
      console.log('🔐 PasswordSetup: ExtensionStorage saved');
      
      // Set session password for runtime operations (this also generates encryption key)
      WalletManager.setSessionPassword(password);
      
      // Store decrypted wallet in encrypted session storage
      await WalletManager.updateSessionWallets([wallet]);
      
      console.log('🔐 PasswordSetup: Session storage saved (encrypted)');
      
      // SECURITY: Remove any unencrypted wallet data that might exist
      localStorage.removeItem('wallets');
      await ExtensionStorageManager.remove('wallets');
      
      // Verify data was saved
      const verifyHash = localStorage.getItem('walletPasswordHash');
      const verifyEncrypted = localStorage.getItem('encryptedWallets');
      console.log('🔐 PasswordSetup: Verify - hash exists:', !!verifyHash, ', encrypted exists:', !!verifyEncrypted);

      onPasswordSet(wallet);
    } catch (error) {
      console.error('🔐 PasswordSetup: Error:', error);
      toast({ title: "Error", description: "Failed to create password", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" />
            Create Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {password && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted  overflow-hidden">
                    <div 
                      className={`h-full transition-all ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{passwordStrength.label}</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {confirmPassword && password !== confirmPassword && (
              <p className="text-sm text-red-500">Passwords do not match</p>
            )}
          </div>

          {capsLockOn && (
            <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="text-xs">Caps Lock is ON</span>
            </div>
          )}

          <div className="flex items-start space-x-2 pt-2">
            <Checkbox
              id="acknowledge"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked as boolean)}
              className="mt-0.5"
            />
            <Label htmlFor="acknowledge" className="text-xs leading-4 cursor-pointer text-muted-foreground">
              I understand this password cannot recover my wallet. I must keep my seed phrase safe.
            </Label>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onBack} disabled={isCreating} className="flex-1">
              Back
            </Button>
            <Button onClick={handleCreatePassword} disabled={isCreating || !isValid} className="flex-1">
              {isCreating ? "Creating..." : "Start OctWa"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
