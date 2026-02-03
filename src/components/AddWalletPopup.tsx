import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { GenerateWallet } from './GenerateWallet';
import { ImportWallet } from './ImportWallet';
import { PageTransition } from './PageTransition';
import { Plus, FileText, Key, ArrowLeft } from 'lucide-react';
import { Wallet } from '../types/wallet';

interface AddWalletPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWalletCreated: (wallet: Wallet) => void;
  isPopupMode?: boolean;
}

type Screen = 'menu' | 'create' | 'import-mnemonic' | 'import-privatekey';

export function AddWalletPopup({
  open,
  onOpenChange,
  onWalletCreated,
  isPopupMode = false,
}: AddWalletPopupProps) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [transitionKey, setTransitionKey] = useState(0);

  const handleWalletGenerated = (wallet: Wallet) => {
    onWalletCreated(wallet);
    handleClose();
  };

  const handleBack = () => {
    setTransitionKey((prev) => prev + 1);
    setScreen('menu');
  };

  const handleNavigate = (newScreen: Screen) => {
    setTransitionKey((prev) => prev + 1);
    setScreen(newScreen);
  };

  const handleClose = () => {
    setScreen('menu');
    setTransitionKey(0);
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) handleClose();
    else onOpenChange(isOpen);
  };

  // Popup mode: smaller and simplified
  if (isPopupMode) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-[360px] max-h-[500px] overflow-hidden p-0"
          aria-describedby={screen === 'menu' ? undefined : undefined}
          hideCloseButton={screen !== 'menu'}
          preventCloseOnOutsideClick
        >
          {screen === 'menu' && (
            <PageTransition key={`menu-${transitionKey}`} variant="fade-slide" duration={200}>
              <DialogHeader className="p-3 pb-2">
                <DialogTitle className="text-sm">Add Wallet</DialogTitle>
                <DialogDescription className="sr-only">Choose how you want to add a wallet</DialogDescription>
              </DialogHeader>
              <div className="p-3 pt-1 space-y-2">
                <Button
                  onClick={() => handleNavigate('create')}
                  className="w-full h-8 text-xs bg-[#3A4DFF] hover:bg-[#6C63FF]/90"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Generate new wallet
                </Button>
                <Button
                  onClick={() => handleNavigate('import-mnemonic')}
                  variant="outline"
                  className="w-full h-8 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Import from Mnemonic
                </Button>
                <Button
                  onClick={() => handleNavigate('import-privatekey')}
                  variant="outline"
                  className="w-full h-8 text-xs"
                >
                  <Key className="h-3.5 w-3.5 mr-1.5" />
                  Import from Private Key
                </Button>
              </div>
            </PageTransition>
          )}

          {screen === 'create' && (
            <PageTransition key={`create-${transitionKey}`} variant="slide-left" duration={200}>
              <div className="flex flex-col h-full max-h-[500px]">
                <div className="p-3 flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                  <DialogTitle className="text-sm">Generate Wallet</DialogTitle>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <GenerateWallet onWalletGenerated={handleWalletGenerated} isCompact />
                </div>
              </div>
            </PageTransition>
          )}

          {screen === 'import-mnemonic' && (
            <PageTransition key={`mnemonic-${transitionKey}`} variant="slide-left" duration={200}>
              <div className="flex flex-col h-full max-h-[500px]">
                <div className="p-3 flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                  <DialogTitle className="text-sm">Import Mnemonic</DialogTitle>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" isCompact />
                </div>
              </div>
            </PageTransition>
          )}

          {screen === 'import-privatekey' && (
            <PageTransition key={`privatekey-${transitionKey}`} variant="slide-left" duration={200}>
              <div className="flex flex-col h-full max-h-[500px]">
                <div className="p-3 flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                  <DialogTitle className="text-sm">Import Private Key</DialogTitle>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" isCompact />
                </div>
              </div>
            </PageTransition>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // Expanded mode: larger dialog with centered text
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-hidden p-0"
        hideCloseButton={screen !== 'menu'}
        preventCloseOnOutsideClick
      >
        {screen === 'menu' && (
          <PageTransition key={`menu-${transitionKey}`} variant="fade-slide" duration={250}>
            <DialogHeader className="p-6 pb-4">
              <DialogTitle className="text-xl">Add New Wallet</DialogTitle>
              <DialogDescription>Choose how you want to add a wallet</DialogDescription>
            </DialogHeader>
            <div className="p-6 pt-2 space-y-3">
              <Button
                onClick={() => handleNavigate('create')}
                className="w-full h-12 text-base bg-[#3A4DFF] hover:bg-[#6C63FF]/90"
                size="lg"
              >
                <Plus className="h-5 w-5 mr-2" />
                Generate new wallet
              </Button>
              <Button
                onClick={() => handleNavigate('import-mnemonic')}
                variant="outline"
                className="w-full h-12 text-base"
                size="lg"
              >
                <FileText className="h-5 w-5 mr-2" />
                Import from Mnemonic
              </Button>
              <Button
                onClick={() => handleNavigate('import-privatekey')}
                variant="outline"
                className="w-full h-12 text-base"
                size="lg"
              >
                <Key className="h-5 w-5 mr-2" />
                Import from Private Key
              </Button>
            </div>
          </PageTransition>
        )}

        {screen === 'create' && (
          <PageTransition key={`create-${transitionKey}`} variant="slide-left" duration={250}>
            <div className="flex flex-col h-full max-h-[85vh]">
              <div className="p-4 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-lg">Generate Wallet</DialogTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <GenerateWallet onWalletGenerated={handleWalletGenerated} hideBorder />
              </div>
            </div>
          </PageTransition>
        )}

        {screen === 'import-mnemonic' && (
          <PageTransition key={`mnemonic-${transitionKey}`} variant="slide-left" duration={250}>
            <div className="flex flex-col h-full max-h-[85vh]">
              <div className="p-4 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-lg">Import from Mnemonic</DialogTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" hideBorder />
              </div>
            </div>
          </PageTransition>
        )}

        {screen === 'import-privatekey' && (
          <PageTransition key={`privatekey-${transitionKey}`} variant="slide-left" duration={250}>
            <div className="flex flex-col h-full max-h-[85vh]">
              <div className="p-4 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-lg">Import from Private Key</DialogTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" hideBorder />
              </div>
            </div>
          </PageTransition>
        )}
      </DialogContent>
    </Dialog>
  );
}
