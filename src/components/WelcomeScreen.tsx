import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GenerateWallet } from './GenerateWallet';
import { ImportWallet } from './ImportWallet';
import { PasswordSetup } from './PasswordSetup';
import { Plus, FileText, Key, ArrowLeft } from 'lucide-react';
import { Wallet } from '../types/wallet';

interface WelcomeScreenProps {
  onWalletCreated: (wallet: Wallet) => void;
}

type Screen = 'menu' | 'create' | 'import-mnemonic' | 'import-privatekey' | 'password';

export function WelcomeScreen({ onWalletCreated }: WelcomeScreenProps) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [pendingWallet, setPendingWallet] = useState<Wallet | null>(null);

  const handleWalletGenerated = (wallet: Wallet) => {
    setPendingWallet(wallet);
    setScreen('password');
  };

  const handlePasswordSet = (wallet: Wallet) => {
    setPendingWallet(null);
    onWalletCreated(wallet);
  };

  const handleBack = () => {
    setScreen('menu');
    setPendingWallet(null);
  };

  // Password Setup Screen
  if (screen === 'password' && pendingWallet) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PasswordSetup
          wallet={pendingWallet}
          onPasswordSet={handlePasswordSet}
          onBack={handleBack}
        />
      </div>
    );
  }

  // Create Wallet Screen
  if (screen === 'create') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <GenerateWallet onWalletGenerated={handleWalletGenerated} />
        </div>
      </div>
    );
  }

  // Import from Mnemonic Screen
  if (screen === 'import-mnemonic') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" />
        </div>
      </div>
    );
  }

  // Import from Private Key Screen
  if (screen === 'import-privatekey') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" />
        </div>
      </div>
    );
  }

  // Main Menu Screen
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="p-3 bg-primary/10 rounded-full border border-primary/20">
              <img 
                src="/icons/octwa128x128.png" 
                alt="OctWa Logo" 
                className="h-12 w-12"
              />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground">OctWa</h1>
          <p className="text-sm text-muted-foreground mt-1">Stay Encrypted</p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <Button 
            onClick={() => setScreen('create')}
            className="w-full h-12 text-base"
            size="lg"
          >
            <Plus className="h-5 w-5 mr-2" />
            Create a new wallet
          </Button>

          <Button 
            onClick={() => setScreen('import-mnemonic')}
            variant="outline"
            className="w-full h-12 text-base"
            size="lg"
          >
            <FileText className="h-5 w-5 mr-2" />
            Import from Mnemonic
          </Button>

          <Button 
            onClick={() => setScreen('import-privatekey')}
            variant="outline"
            className="w-full h-12 text-base"
            size="lg"
          >
            <Key className="h-5 w-5 mr-2" />
            Import from Private Key
          </Button>
        </div>
      </div>
    </div>
  );
}