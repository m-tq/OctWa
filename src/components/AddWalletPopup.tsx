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

  const handleWalletGenerated = (wallet: Wallet) => {
    onWalletCreated(wallet);
    handleClose();
  };

  const handleBack = () => {
    setScreen('menu');
  };

  const handleClose = () => {
    setScreen('menu');
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
        <DialogContent className="w-[360px] max-h-[500px] overflow-hidden p-0">
          {screen === 'menu' && (
            <>
              <DialogHeader className="p-3 pb-2">
                <DialogTitle className="text-sm">Add Wallet</DialogTitle>
              </DialogHeader>
              <div className="p-3 pt-1 space-y-2">
                <Button
                  onClick={() => setScreen('create')}
                  className="w-full h-8 text-xs bg-[#0000db] hover:bg-[#0000db]/90"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Generate new wallet
                </Button>
                <Button
                  onClick={() => setScreen('import-mnemonic')}
                  variant="outline"
                  className="w-full h-8 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Import from Mnemonic
                </Button>
                <Button
                  onClick={() => setScreen('import-privatekey')}
                  variant="outline"
                  className="w-full h-8 text-xs"
                >
                  <Key className="h-3.5 w-3.5 mr-1.5" />
                  Import from Private Key
                </Button>
              </div>
            </>
          )}

          {screen === 'create' && (
            <div className="flex flex-col h-full max-h-[500px]">
              <div className="p-3 pb-2 flex items-center gap-2 border-b">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <DialogTitle className="text-sm">Generate Wallet</DialogTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <GenerateWallet onWalletGenerated={handleWalletGenerated} isCompact />
              </div>
            </div>
          )}

          {screen === 'import-mnemonic' && (
            <div className="flex flex-col h-full max-h-[500px]">
              <div className="p-3 pb-2 flex items-center gap-2 border-b">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <DialogTitle className="text-sm">Import Mnemonic</DialogTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" isCompact />
              </div>
            </div>
          )}

          {screen === 'import-privatekey' && (
            <div className="flex flex-col h-full max-h-[500px]">
              <div className="p-3 pb-2 flex items-center gap-2 border-b">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-6 w-6 p-0">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <DialogTitle className="text-sm">Import Private Key</DialogTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" isCompact />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // Expanded mode: larger dialog with centered text
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden p-0">
        {screen === 'menu' && (
          <>
            <DialogHeader className="p-6 pb-4">
              <DialogTitle className="text-xl">Add New Wallet</DialogTitle>
              <DialogDescription>Choose how you want to add a wallet</DialogDescription>
            </DialogHeader>
            <div className="p-6 pt-2 space-y-3">
              <Button
                onClick={() => setScreen('create')}
                className="w-full h-12 text-base bg-[#0000db] hover:bg-[#0000db]/90"
                size="lg"
              >
                <Plus className="h-5 w-5 mr-2" />
                Generate new wallet
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
          </>
        )}

        {screen === 'create' && (
          <div className="flex flex-col h-full max-h-[85vh]">
            <div className="p-4 pb-2 flex items-center gap-2 border-b">
              <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle className="text-lg">Generate Wallet</DialogTitle>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <GenerateWallet onWalletGenerated={handleWalletGenerated} />
            </div>
          </div>
        )}

        {screen === 'import-mnemonic' && (
          <div className="flex flex-col h-full max-h-[85vh]">
            <div className="p-4 pb-2 flex items-center gap-2 border-b">
              <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle className="text-lg">Import from Mnemonic</DialogTitle>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="mnemonic" />
            </div>
          </div>
        )}

        {screen === 'import-privatekey' && (
          <div className="flex flex-col h-full max-h-[85vh]">
            <div className="p-4 pb-2 flex items-center gap-2 border-b">
              <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle className="text-lg">Import from Private Key</DialogTitle>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <ImportWallet onWalletImported={handleWalletGenerated} defaultTab="private-key" />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
