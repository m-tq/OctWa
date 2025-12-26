import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Key, FileText, Loader2 } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { importWalletFromPrivateKey, importWalletFromMnemonic } from '../utils/wallet';
import { useToast } from '@/hooks/use-toast';

interface ImportWalletProps {
  onWalletImported: (wallet: Wallet) => void;
  defaultTab?: 'private-key' | 'mnemonic';
  isCompact?: boolean;
}

export function ImportWallet({ onWalletImported, defaultTab = 'private-key', isCompact = false }: ImportWalletProps) {
  const [privateKey, setPrivateKey] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  const handleImportFromPrivateKey = async () => {
    if (!privateKey.trim()) {
      toast({ title: "Error", description: "Private key required", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const wallet = await importWalletFromPrivateKey(privateKey.trim());
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      if (existingWallets.some((w: Wallet) => w.address === wallet.address)) {
        toast({ title: "Wallet Already Exists", description: "This wallet is already in your collection", variant: "destructive" });
        return;
      }
      onWalletImported(wallet);
      toast({ title: "Success!", description: "Wallet imported successfully" });
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
      toast({ title: "Import Failed", description: errorMessage, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromMnemonic = async () => {
    if (!mnemonic.trim()) {
      toast({ title: "Error", description: "Mnemonic required", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const wallet = await importWalletFromMnemonic(mnemonic.trim());
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      if (existingWallets.some((w: Wallet) => w.address === wallet.address)) {
        toast({ title: "Wallet Already Exists", description: "This wallet is already in your collection", variant: "destructive" });
        return;
      }
      onWalletImported(wallet);
      toast({ title: "Success!", description: "Wallet imported successfully" });
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
      toast({ title: "Import Failed", description: errorMessage, variant: "destructive" });
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
            <Label htmlFor="mnemonic" className="text-xs text-muted-foreground">Mnemonic Phrase</Label>
            <Textarea
              id="mnemonic"
              placeholder="Enter 12 or 24 words"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              rows={3}
              className="font-mono text-xs mt-1.5"
            />
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
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Import from Mnemonic
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mnemonic">Mnemonic Phrase</Label>
            <Textarea
              id="mnemonic"
              placeholder="Enter your 12 or 24 word mnemonic phrase"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              rows={3}
              className="font-mono text-sm"
            />
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
          <Label htmlFor="private-key" className="text-xs text-muted-foreground">Private Key</Label>
          <Input
            id="private-key"
            type="password"
            placeholder="Enter private key (Base64)"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            className="font-mono text-xs mt-1.5"
          />
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
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Key className="h-5 w-5" />
          Import from Private Key
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="private-key">Private Key</Label>
          <Input
            id="private-key"
            type="password"
            placeholder="Enter your private key (Base64)"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            className="font-mono text-sm"
          />
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
