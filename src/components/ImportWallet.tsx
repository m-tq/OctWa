import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Key, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { importWalletFromPrivateKey, importWalletFromMnemonic } from '../utils/wallet';
import { useToast } from '@/hooks/use-toast';

interface ImportWalletProps {
  onWalletImported: (wallet: Wallet) => void;
}

export function ImportWallet({ onWalletImported }: ImportWalletProps) {
  const [privateKey, setPrivateKey] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  const handleImportFromPrivateKey = async () => {
    if (!privateKey.trim()) {
      toast({
        title: "Error",
        description: "Private key required",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    try {
      const wallet = await importWalletFromPrivateKey(privateKey.trim());
      
      // Check if wallet already exists
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      const walletExists = existingWallets.some((w: Wallet) => w.address === wallet.address);
      
      if (walletExists) {
        toast({
          title: "Wallet Already Exists",
          description: "This wallet is already in your collection",
          variant: "destructive",
        });
        return;
      }
      
      onWalletImported(wallet);
      toast({
        title: "Success!",
        description: "Wallet imported successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Import failed",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromMnemonic = async () => {
    if (!mnemonic.trim()) {
      toast({
        title: "Error",
        description: "Mnemonic required",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    try {
      const wallet = await importWalletFromMnemonic(mnemonic.trim());
      
      // Check if wallet already exists
      const existingWallets = JSON.parse(localStorage.getItem('wallets') || '[]');
      const walletExists = existingWallets.some((w: Wallet) => w.address === wallet.address);
      
      if (walletExists) {
        toast({
          title: "Wallet Already Exists",
          description: "This wallet is already in your collection",
          variant: "destructive",
        });
        return;
      }
      
      onWalletImported(wallet);
      toast({
        title: "Success!",
        description: "Wallet imported successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Import failed",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert>
        <div className="flex items-start space-x-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <AlertDescription>
            Only import wallets from trusted sources. Never share your private key or mnemonic phrase with anyone.
          </AlertDescription>
        </div>
      </Alert>

      <Tabs defaultValue="private-key" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="private-key" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Private Key
          </TabsTrigger>
          <TabsTrigger value="mnemonic" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Mnemonic
          </TabsTrigger>
        </TabsList>

        <TabsContent value="private-key" className="space-y-4 mt-6">
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
            <p className="text-sm text-muted-foreground">
              Enter your private key in Base64 format
            </p>
          </div>

          <Button 
            onClick={handleImportFromPrivateKey}
            disabled={isImporting || !privateKey.trim()}
            className="w-full"
            size="lg"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              "Import Wallet"
            )}
          </Button>
        </TabsContent>

        <TabsContent value="mnemonic" className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="mnemonic">Mnemonic Phrase</Label>
            <Textarea
              id="mnemonic"
              placeholder="Enter your 12 or 24 word mnemonic phrase"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              rows={4}
                className="font-mono text-sm"
            />
            <p className="text-sm text-muted-foreground">
              Enter your mnemonic phrase separated by spaces (12 or 24 words)
            </p>
          </div>

          <Button 
            onClick={handleImportFromMnemonic}
            disabled={isImporting || !mnemonic.trim()}
            className="w-full"
            size="lg"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              "Import Wallet"
            )}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}