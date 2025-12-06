import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Plus, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { generateWallet } from '../utils/wallet';
import { useToast } from '@/hooks/use-toast';

interface GenerateWalletProps {
  onWalletGenerated: (wallet: Wallet) => void;
}

export function GenerateWallet({ onWalletGenerated }: GenerateWalletProps) {
  const [generatedWallet, setGeneratedWallet] = useState<Wallet | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasBackedUp, setHasBackedUp] = useState(false);
  const { toast } = useToast();

  const handleGenerateWallet = async () => {
    setIsGenerating(true);
    try {
      const wallet = await generateWallet();
      setGeneratedWallet(wallet);
      setHasBackedUp(false);
      toast({
        title: "Wallet Generated!",
        description: "Please backup your wallet information securely",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Generation failed",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Copy failed",
        variant: "destructive",
      });
    }
  };

  const handleSaveWallet = () => {
    if (!generatedWallet) return;
    
    if (!hasBackedUp) {
      toast({
        title: "Backup Required",
        description: "Confirm backup first",
        variant: "destructive",
      });
      return;
    }

    onWalletGenerated(generatedWallet);
  };

  if (!generatedWallet) {
    return (
      <div className="space-y-4">
        <Alert>
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <AlertDescription>
              Make sure to backup your wallet information securely. 
              Loss of private key or mnemonic phrase will result in permanent loss of funds.
            </AlertDescription>
          </div>
        </Alert>

        <Button 
          onClick={handleGenerateWallet}
          disabled={isGenerating}
          className="w-full"
          size="lg"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              Generate New Wallet
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert className="border-green-200 bg-green-50 dark:bg-green-950">
        <div className="flex items-start space-x-3">
          <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            Wallet generated successfully! Please backup the information below.
          </AlertDescription>
        </div>
      </Alert>

      {/* Wallet Address */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Wallet Address</label>
        <div className="flex items-center space-x-2">
          <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
            {generatedWallet.address}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(generatedWallet.address, 'Address')}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mnemonic */}
      {generatedWallet.mnemonic && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Mnemonic Phrase</label>
          <div className="p-4 bg-muted rounded-md">
            <div className="grid grid-cols-3 gap-3">
              {generatedWallet.mnemonic.split(' ').map((word, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Badge variant="outline" className="w-8 h-6 text-xs">
                    {index + 1}
                  </Badge>
                  <span className="font-mono text-sm">{word}</span>
                </div>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(generatedWallet.mnemonic!, 'Mnemonic')}
            className="w-full mt-2"
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy Mnemonic Phrase
          </Button>
        </div>
      )}

      {/* Private Key */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Private Key (Base64)</label>
        <div className="flex items-center space-x-2">
          <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
            {generatedWallet.privateKey}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(generatedWallet.privateKey, 'Private Key')}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Backup Confirmation */}
      <div className="space-y-4">
        <Alert>
          <div className="flex items-start space-x-3">
            <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <AlertDescription>
              Please confirm that you have securely backed up your wallet information.
              This includes your private key and mnemonic phrase.
            </AlertDescription>
          </div>
        </Alert>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="backup-confirm"
            checked={hasBackedUp}
            onChange={(e) => setHasBackedUp(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="backup-confirm" className="text-sm">
            I have securely backed up my wallet information
          </label>
        </div>

        <div className="flex space-x-3">
          <Button 
            variant="outline"
            onClick={() => setGeneratedWallet(null)}
            className="flex-1"
          >
            Generate Another
          </Button>
          <Button 
            onClick={handleSaveWallet}
            disabled={!hasBackedUp}
            className="flex-1"
            size="lg"
          >
            Continue to Wallet
          </Button>
        </div>
      </div>
    </div>
  );
}