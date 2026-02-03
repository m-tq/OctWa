import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GenerateWallet } from './GenerateWallet';
import { ImportWallet } from './ImportWallet';
import { PasswordSetup } from './PasswordSetup';
import { PageTransition } from './PageTransition';
import { OctraBackground } from './OctraBackground';
import { Plus, FileText, Key, ArrowLeft } from 'lucide-react';
import { Wallet } from '../types/wallet';

interface WelcomeScreenProps {
  onWalletCreated: (wallet: Wallet) => void;
}

type Screen = 'menu' | 'create' | 'import-mnemonic' | 'import-privatekey' | 'password';

export function WelcomeScreen({ onWalletCreated }: WelcomeScreenProps) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [pendingWallet, setPendingWallet] = useState<Wallet | null>(null);
  const [transitionKey, setTransitionKey] = useState(0);

  const handleWalletGenerated = (wallet: Wallet) => {
    setPendingWallet(wallet);
    setTransitionKey(prev => prev + 1);
    setScreen('password');
  };

  const handlePasswordSet = (wallet: Wallet) => {
    setPendingWallet(null);
    onWalletCreated(wallet);
  };

  const handleBack = () => {
    setTransitionKey(prev => prev + 1);
    setScreen('menu');
    setPendingWallet(null);
  };

  // Password Setup Screen
  if (screen === 'password' && pendingWallet) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
        <OctraBackground />
        <div className="w-full max-w-md relative z-10">
          <PageTransition key={`password-${transitionKey}`} variant="slide-left" duration={250}>
            <PasswordSetup
              wallet={pendingWallet}
              onPasswordSet={handlePasswordSet}
              onBack={handleBack}
            />
          </PageTransition>
        </div>
      </div>
    );
  }

  // Create Wallet Screen
  if (screen === 'create') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
        <OctraBackground />
        <div className="w-full max-w-md sm:max-w-lg relative z-10">
          <PageTransition key={`create-${transitionKey}`} variant="slide-left" duration={250}>
            <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <GenerateWallet onWalletGenerated={handleWalletGenerated} />
          </PageTransition>
        </div>
      </div>
    );
  }

  // Import from Mnemonic Screen
  if (screen === 'import-mnemonic') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
        <OctraBackground />
        <div className="w-full max-w-md relative z-10">
          <PageTransition key={`mnemonic-${transitionKey}`} variant="slide-left" duration={250}>
            <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" />
          </PageTransition>
        </div>
      </div>
    );
  }

  // Import from Private Key Screen
  if (screen === 'import-privatekey') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
        <OctraBackground />
        <div className="w-full max-w-md relative z-10">
          <PageTransition key={`privatekey-${transitionKey}`} variant="slide-left" duration={250}>
            <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" />
          </PageTransition>
        </div>
      </div>
    );
  }

  // Main Menu Screen
  return (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
      <OctraBackground />
      <PageTransition key={`menu-${transitionKey}`} variant="fade-slide" duration={300}>
        <div className="w-full max-w-sm relative" style={{ zIndex: 10 }}>
          {/* Logo & Title */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <div className="p-4 bg-primary/10 rounded-full border border-primary/20">
                <svg
                  viewBox="0 0 50 50"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-20 w-20"
                  style={{ width: '82px', height: '82px' }}
                  role="img"
                  aria-label="OctWa Logo"
                >
                  <circle
                    cx="25"
                    cy="25"
                    r="21"
                    stroke="#3A4DFF"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle cx="25" cy="25" r="9" fill="#3A4DFF" />
                </svg>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-foreground">{__APP_NAME__.split(' ')[0]}</h1>
            <p className="text-sm text-muted-foreground font-medium mt-1">Encrypted by Default</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Powered by Octra HFHE</p>
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
      </PageTransition>
    </div>
  );
}
