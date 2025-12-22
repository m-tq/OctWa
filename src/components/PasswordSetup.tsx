import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Eye, EyeOff, AlertTriangle, CheckCircle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { hashPassword, encryptWalletData, validatePasswordStrength } from '../utils/password';
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
  const [acknowledgeRecovery, setAcknowledgeRecovery] = useState(false);
  const [acknowledgeBrowser, setAcknowledgeBrowser] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const { toast } = useToast();

  // Password strength validation
  const passwordStrength = useMemo(() => {
    if (!password) return null;
    return validatePasswordStrength(password);
  }, [password]);

  const getStrengthColor = (score: number) => {
    if (score <= 2) return 'bg-red-500';
    if (score <= 4) return 'bg-yellow-500';
    if (score <= 5) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const getStrengthLabel = (score: number) => {
    if (score <= 2) return 'Weak';
    if (score <= 4) return 'Fair';
    if (score <= 5) return 'Good';
    return 'Strong';
  };

  const validatePassword = () => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match';
    }
    return null;
  };

  const handleCreatePassword = async () => {
    const validationError = validatePassword();
    if (validationError) {
      toast({
        title: "Validation Error",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    if (!acknowledgeRecovery || !acknowledgeBrowser) {
      toast({
        title: "Acknowledgment Required",
        description: "Please acknowledge both security warnings",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      console.log('🔐 PasswordSetup: Creating password protection...');
      
      // Hash the password
      const { hashedPassword, salt } = await hashPassword(password);
      console.log('✅ PasswordSetup: Password hashed successfully');
      
      // Get ALL existing wallets that need to be encrypted
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      console.log(`📦 PasswordSetup: Found ${existingWallets.length} existing wallets to encrypt`);
      
      // CRITICAL FIX: Encrypt ALL wallets (including the current one and any existing ones)
      let walletsToEncrypt: Wallet[];
      
      // Check if current wallet already exists in the list
      const walletExists = existingWallets.find((w: Wallet) => w.address === wallet.address);
      
      if (walletExists) {
        // Current wallet already exists, encrypt all existing wallets
        walletsToEncrypt = existingWallets;
        console.log(`📦 PasswordSetup: Current wallet already exists, encrypting ${existingWallets.length} existing wallets`);
      } else {
        // Current wallet is new, add it to the list
        walletsToEncrypt = [...existingWallets, wallet];
        console.log(`📦 PasswordSetup: Adding current wallet to ${existingWallets.length} existing wallets`);
      }
      
      console.log(`🔐 PasswordSetup: Will encrypt ${walletsToEncrypt.length} wallets total`);
      
      const encryptedWallets = [];
      
      for (const walletToEncrypt of walletsToEncrypt) {
        try {
          const walletData = JSON.stringify(walletToEncrypt);
          const encryptedWalletData = await encryptWalletData(walletData, password);
          
          encryptedWallets.push({
            address: walletToEncrypt.address,
            encryptedData: encryptedWalletData,
            createdAt: Date.now()
          });
          
          console.log(`🔐 PasswordSetup: Encrypted wallet ${walletToEncrypt.address.slice(0, 8)}...`);
        } catch (error) {
          console.error(`❌ PasswordSetup: Failed to encrypt wallet ${walletToEncrypt.address}:`, error);
          // Don't throw here, continue with other wallets
        }
      }
      
      console.log(`✅ PasswordSetup: Successfully encrypted ${encryptedWallets.length} wallets`);
      
      // Store password hash in BOTH localStorage AND ExtensionStorageManager for cross-context sync
      localStorage.setItem('walletPasswordHash', hashedPassword);
      localStorage.setItem('walletPasswordSalt', salt);
      localStorage.setItem('isWalletLocked', 'false');
      
      // CRITICAL: Also store in ExtensionStorageManager for popup mode
      await ExtensionStorageManager.set('walletPasswordHash', hashedPassword);
      await ExtensionStorageManager.set('walletPasswordSalt', salt);
      await ExtensionStorageManager.set('isWalletLocked', 'false');
      
      // Set session password so new wallets can be encrypted
      WalletManager.setSessionPassword(password);
      
      // CRITICAL FIX: Store ALL encrypted wallets (this replaces any existing encrypted wallets)
      if (encryptedWallets.length > 0) {
        localStorage.setItem('encryptedWallets', JSON.stringify(encryptedWallets));
        await ExtensionStorageManager.set('encryptedWallets', JSON.stringify(encryptedWallets));
        console.log(`📦 PasswordSetup: Stored ${encryptedWallets.length} encrypted wallets`);
      } else {
        console.error('❌ PasswordSetup: No wallets were successfully encrypted!');
        throw new Error('Failed to encrypt any wallets');
      }
      
      // Ensure all wallets are also available in unencrypted storage for immediate use
      localStorage.setItem('wallets', JSON.stringify(walletsToEncrypt));
      await ExtensionStorageManager.set('wallets', JSON.stringify(walletsToEncrypt));
      console.log(`💾 PasswordSetup: Maintained ${walletsToEncrypt.length} wallets in unencrypted storage`);
      
      // Set the current wallet as the active wallet
      localStorage.setItem('activeWalletId', wallet.address);
      await ExtensionStorageManager.set('activeWalletId', wallet.address);
      
      toast({
        title: "Password Created!",
        description: `Your ${walletsToEncrypt.length} wallet(s) are now protected with a password`,
      });
      
      console.log('🎉 PasswordSetup: Password protection setup completed successfully');
      onPasswordSet(wallet);
    } catch (error) {
      console.error('❌ PasswordSetup: Password creation error:', error);
      toast({
        title: "Error",
        description: "Failed to create password protection",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Only show error after user has interacted with the fields
  const getPasswordError = () => {
    if (!passwordTouched && !confirmTouched) return null;
    if (passwordTouched && password.length > 0 && password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (confirmTouched && confirmPassword.length > 0 && password !== confirmPassword) {
      return 'Passwords do not match';
    }
    return null;
  };

  const passwordError = getPasswordError();

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Secure Your Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <AlertDescription>
                Create a password to protect your wallet.
              </AlertDescription>
            </div>
          </Alert>

          {/* Password Field */}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter a strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setPasswordTouched(true)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            
            {/* Password Strength Indicator */}
            {password && passwordStrength && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${getStrengthColor(passwordStrength.score)}`}
                      style={{ width: `${(passwordStrength.score / 7) * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${
                    passwordStrength.score <= 2 ? 'text-red-500' :
                    passwordStrength.score <= 4 ? 'text-yellow-500' :
                    passwordStrength.score <= 5 ? 'text-blue-500' : 'text-green-500'
                  }`}>
                    {getStrengthLabel(passwordStrength.score)}
                  </span>
                </div>
                
                {/* Password Requirements */}
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className={`flex items-center gap-1 ${password.length >= 8 ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <CheckCircle className={`h-3 w-3 ${password.length >= 8 ? 'opacity-100' : 'opacity-30'}`} />
                    8+ characters
                  </div>
                  <div className={`flex items-center gap-1 ${/[A-Z]/.test(password) ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <CheckCircle className={`h-3 w-3 ${/[A-Z]/.test(password) ? 'opacity-100' : 'opacity-30'}`} />
                    Uppercase
                  </div>
                  <div className={`flex items-center gap-1 ${/[a-z]/.test(password) ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <CheckCircle className={`h-3 w-3 ${/[a-z]/.test(password) ? 'opacity-100' : 'opacity-30'}`} />
                    Lowercase
                  </div>
                  <div className={`flex items-center gap-1 ${/[0-9]/.test(password) ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <CheckCircle className={`h-3 w-3 ${/[0-9]/.test(password) ? 'opacity-100' : 'opacity-30'}`} />
                    Number
                  </div>
                  <div className={`flex items-center gap-1 ${/[^a-zA-Z0-9]/.test(password) ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <CheckCircle className={`h-3 w-3 ${/[^a-zA-Z0-9]/.test(password) ? 'opacity-100' : 'opacity-30'}`} />
                    Special char
                  </div>
                  <div className={`flex items-center gap-1 ${password.length >= 12 ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <CheckCircle className={`h-3 w-3 ${password.length >= 12 ? 'opacity-100' : 'opacity-30'}`} />
                    12+ chars (bonus)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Confirm Password Field */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setConfirmTouched(true)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            {passwordError && (
              <p className="text-sm text-red-600">{passwordError}</p>
            )}
          </div>

          {/* Acknowledgments */}
          <div className="space-y-4">
            <div className="flex items-start space-x-2">
              <Checkbox
                id="acknowledge-recovery"
                checked={acknowledgeRecovery}
                onCheckedChange={(checked) => setAcknowledgeRecovery(checked as boolean)}
                className="mt-0.5"
              />
              <Label htmlFor="acknowledge-recovery" className="text-sm leading-5 cursor-pointer">
                I acknowledge that this password can not be used to recover my accounts, I still need to preserve the recovery methods used when first creating my accounts (seed phrase etc.)
              </Label>
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox
                id="acknowledge-browser"
                checked={acknowledgeBrowser}
                onCheckedChange={(checked) => setAcknowledgeBrowser(checked as boolean)}
                className="mt-0.5"
              />
              <Label htmlFor="acknowledge-browser" className="text-sm leading-5 cursor-pointer">
                I acknowledge that storing this password in my browser's password manager exposes me to additional risk (we recommend you do not).
              </Label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onBack}
              disabled={isCreating}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              onClick={handleCreatePassword}
              disabled={isCreating || !password || !confirmPassword || !acknowledgeRecovery || !acknowledgeBrowser || !!passwordError}
              className="flex-1"
            >
              {isCreating ? "Creating..." : "Next"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}