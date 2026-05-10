import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GenerateWallet } from './GenerateWallet';
import { ImportWallet } from './ImportWallet';
import { PasswordSetup } from './PasswordSetup';
import { PageTransition } from './PageTransition';
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

  const screenWrapper = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
      <div className="w-full max-w-md relative z-10">
        {children}
      </div>
    </div>
  );

  if (screen === 'password' && pendingWallet) {
    return screenWrapper(
      <PageTransition key={`password-${transitionKey}`} variant="slide-left" duration={250}>
        <PasswordSetup
          wallet={pendingWallet}
          onPasswordSet={handlePasswordSet}
          onBack={handleBack}
        />
      </PageTransition>
    );
  }

  if (screen === 'create') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
        <div className="w-full max-w-md sm:max-w-lg relative z-10">
          <PageTransition key={`create-${transitionKey}`} variant="slide-left" duration={250}>
            <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              back
            </Button>
            <GenerateWallet onWalletGenerated={handleWalletGenerated} />
          </PageTransition>
        </div>
      </div>
    );
  }

  if (screen === 'import-mnemonic') {
    return screenWrapper(
      <PageTransition key={`mnemonic-${transitionKey}`} variant="slide-left" duration={250}>
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          back
        </Button>
        <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" />
      </PageTransition>
    );
  }

  if (screen === 'import-privatekey') {
    return screenWrapper(
      <PageTransition key={`privatekey-${transitionKey}`} variant="slide-left" duration={250}>
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          back
        </Button>
        <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" />
      </PageTransition>
    );
  }

  // Main menu — scanner-first, no hero decoration
  return (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative">
      <PageTransition key={`menu-${transitionKey}`} variant="fade-slide" duration={300}>
        <div className="w-full max-w-sm relative" style={{ zIndex: 10 }}>

          {/* Logo & title — compact, no oversized hero type */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <svg
                viewBox="0 0 50 50"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                width={64}
                height={64}
                role="img"
                aria-label="OctWa Logo"
              >
                <circle cx="25" cy="25" r="21" stroke="#3B567F" strokeWidth="8" fill="none" />
                <circle cx="25" cy="25" r="9" fill="#3B567F" />
              </svg>
            </div>
            {/* 12px header title — matches oct-type-size-03 */}
            <div
              className="font-bold text-primary"
              style={{ fontSize: 'var(--oct-type-size-03)', letterSpacing: 'var(--oct-letter-space)' }}
            >
              {__APP_NAME__.split(' ')[0].toLowerCase()} | wallet
            </div>
            <div
              className="text-muted-foreground mt-1"
              style={{ fontSize: 'var(--oct-type-size-02)' }}
            >
              encrypted by default
            </div>
            <div
              className="text-muted-foreground/60 mt-0.5"
              style={{ fontSize: 'var(--oct-type-size-01)' }}
            >
              powered by octra hfhe
            </div>
          </div>

          {/* Action buttons — lowercase, flat */}
          <div className="space-y-2">
            <Button
              onClick={() => setScreen('create')}
              className="w-full h-9"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              create new wallet
            </Button>

            <Button
              onClick={() => setScreen('import-mnemonic')}
              variant="outline"
              className="w-full h-9"
            >
              <FileText className="h-3.5 w-3.5 mr-2" />
              import from mnemonic
            </Button>

            <Button
              onClick={() => setScreen('import-privatekey')}
              variant="outline"
              className="w-full h-9"
            >
              <Key className="h-3.5 w-3.5 mr-2" />
              import from private key
            </Button>
          </div>
        </div>
      </PageTransition>
    </div>
  );
}
