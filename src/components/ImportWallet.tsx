import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Key, FileText, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { importWalletFromPrivateKey, importWalletFromMnemonic } from '../utils/wallet';

interface ImportWalletProps {
  onWalletImported: (wallet: Wallet) => void;
  defaultTab?: 'private-key' | 'mnemonic';
  isCompact?: boolean;
  hideBorder?: boolean;
}

export function ImportWallet({ onWalletImported, defaultTab = 'private-key', isCompact = false, hideBorder = false }: ImportWalletProps) {
  const [privateKey, setPrivateKey] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [privateKeyError, setPrivateKeyError] = useState('');
  const [mnemonicError, setMnemonicError] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  const handleImportFromPrivateKey = async () => {
    setPrivateKeyError('');
    if (!privateKey.trim()) {
      setPrivateKeyError('Private key required');
      return;
    }

    setIsImporting(true);
    try {
      const wallet = await importWalletFromPrivateKey(privateKey.trim());
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      if (existingWallets.some((w: Wallet) => w.address === wallet.address)) {
        setPrivateKeyError('This wallet is already in your collection');
        return;
      }
      onWalletImported(wallet);
    } catch (error: unknown) {
      let errorMessage = "Failed to import wallet";
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid') || msg.includes('decode') || msg.includes('base64')) {
          errorMessage = "Invalid private key format";
        } else if (msg.includes('length') || msg.includes('size')) {
          errorMessage = "Private key has incorrect length";
        } else {
          errorMessage = error.message || errorMessage;
        }
      }
      setPrivateKeyError(errorMessage);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromMnemonic = async () => {
    setMnemonicError('');
    if (!mnemonic.trim()) {
      setMnemonicError('Mnemonic required');
      return;
    }

    setIsImporting(true);
    try {
      const wallet = await importWalletFromMnemonic(mnemonic.trim());
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      if (existingWallets.some((w: Wallet) => w.address === wallet.address)) {
        setMnemonicError('This wallet is already in your collection');
        return;
      }
      onWalletImported(wallet);
    } catch (error: unknown) {
      let errorMessage = "Failed to import wallet";
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid mnemonic') || msg.includes('invalid word')) {
          errorMessage = "Invalid mnemonic phrase";
        } else if (msg.includes('checksum')) {
          errorMessage = "Mnemonic checksum failed";
        } else if (msg.includes('12') || msg.includes('24') || msg.includes('length')) {
          errorMessage = "Mnemonic must be 12 or 24 words";
        } else {
          errorMessage = error.message || errorMessage;
        }
      }
      setMnemonicError(errorMessage);
    } finally {
      setIsImporting(false);
    }
  };

  if (defaultTab === 'mnemonic') {
    // Compact mode for popup
    if (isCompact) {
      return (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="mnemonic" className="text-xs text-muted-foreground">Mnemonic Phrase</Label>
              {mnemonic && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowMnemonic(!showMnemonic)}
                >
                  {showMnemonic ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                  {showMnemonic ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
            <div className="relative">
              <Textarea
                id="mnemonic"
                placeholder="Enter 12 or 24 words"
                value={mnemonic}
                onChange={(e) => { setMnemonic(e.target.value); setMnemonicError(''); }}
                rows={3}
                className={`font-mono text-xs mt-1.5 ${mnemonicError ? 'border-destructive' : ''} ${!showMnemonic && mnemonic ? 'text-transparent' : ''}`}
                style={!showMnemonic && mnemonic ? { textShadow: '0 0 8px currentColor' } : undefined}
              />
              {!showMnemonic && mnemonic && (
                <div 
                  className="absolute inset-0 mt-1.5 flex items-center justify-center bg-muted/50 rounded-md cursor-pointer backdrop-blur-sm"
                  onClick={() => setShowMnemonic(true)}
                >
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    Click to reveal
                  </span>
                </div>
              )}
            </div>
            {mnemonicError && (
              <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {mnemonicError}
              </p>
            )}
          </div>
          <Button 
            onClick={handleImportFromMnemonic}
            disabled={isImporting || !mnemonic.trim()}
            className="w-full h-8 text-xs"
            size="sm"
          >
            {isImporting ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Importing...</> : "Import Wallet"}
          </Button>
        </div>
      );
    }

    return (
      <Card className={hideBorder ? 'border-0 shadow-none' : ''}>
        {!hideBorder && (
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5" />
              Import from Mnemonic
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className={`space-y-4 ${hideBorder ? 'p-0' : ''}`}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="mnemonic">Mnemonic Phrase</Label>
              {mnemonic && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowMnemonic(!showMnemonic)}
                >
                  {showMnemonic ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                  {showMnemonic ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
            <div className="relative">
              <Textarea
                id="mnemonic"
                placeholder="Enter your 12 or 24 word mnemonic phrase"
                value={mnemonic}
                onChange={(e) => { setMnemonic(e.target.value); setMnemonicError(''); }}
                rows={3}
                className={`font-mono text-sm ${mnemonicError ? 'border-destructive' : ''} ${!showMnemonic && mnemonic ? 'text-transparent' : ''}`}
                style={!showMnemonic && mnemonic ? { textShadow: '0 0 8px currentColor' } : undefined}
              />
              {!showMnemonic && mnemonic && (
                <div 
                  className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-md cursor-pointer backdrop-blur-sm"
                  onClick={() => setShowMnemonic(true)}
                >
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Eye className="h-4 w-4" />
                    Click to reveal
                  </span>
                </div>
              )}
            </div>
            {mnemonicError && (
              <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {mnemonicError}
              </p>
            )}
          </div>
          <Button 
            onClick={handleImportFromMnemonic}
            disabled={isImporting || !mnemonic.trim()}
            className="w-full"
            size="lg"
          >
            {isImporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</> : "Import Wallet"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Compact mode for private key
  if (isCompact) {
    return (
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="private-key" className="text-xs text-muted-foreground">Private Key</Label>
            {privateKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
              >
                {showPrivateKey ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                {showPrivateKey ? 'Hide' : 'Show'}
              </Button>
            )}
          </div>
          <Input
            id="private-key"
            type={showPrivateKey ? "text" : "password"}
            placeholder="Enter private key (Base64)"
            value={privateKey}
            onChange={(e) => { setPrivateKey(e.target.value); setPrivateKeyError(''); }}
            className={`font-mono text-xs mt-1.5 ${privateKeyError ? 'border-destructive' : ''}`}
          />
          {privateKeyError && (
            <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {privateKeyError}
            </p>
          )}
        </div>
        <Button 
          onClick={handleImportFromPrivateKey}
          disabled={isImporting || !privateKey.trim()}
          className="w-full h-8 text-xs"
          size="sm"
        >
          {isImporting ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Importing...</> : "Import Wallet"}
        </Button>
      </div>
    );
  }

  return (
    <Card className={hideBorder ? 'border-0 shadow-none' : ''}>
      {!hideBorder && (
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="h-5 w-5" />
            Import from Private Key
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={`space-y-4 ${hideBorder ? 'p-0' : ''}`}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="private-key">Private Key</Label>
            {privateKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
              >
                {showPrivateKey ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                {showPrivateKey ? 'Hide' : 'Show'}
              </Button>
            )}
          </div>
          <Input
            id="private-key"
            type={showPrivateKey ? "text" : "password"}
            placeholder="Enter your private key (Base64)"
            value={privateKey}
            onChange={(e) => { setPrivateKey(e.target.value); setPrivateKeyError(''); }}
            className={`font-mono text-sm ${privateKeyError ? 'border-destructive' : ''}`}
          />
          {privateKeyError && (
            <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {privateKeyError}
            </p>
          )}
        </div>
        <Button 
          onClick={handleImportFromPrivateKey}
          disabled={isImporting || !privateKey.trim()}
          className="w-full"
          size="lg"
        >
          {isImporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</> : "Import Wallet"}
        </Button>
      </CardContent>
    </Card>
  );
}
