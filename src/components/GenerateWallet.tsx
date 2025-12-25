import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Loader2 } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { generateWallet } from '../utils/wallet';
import { useToast } from '@/hooks/use-toast';

interface GenerateWalletProps {
  onWalletGenerated: (wallet: Wallet) => void;
}

export function GenerateWallet({ onWalletGenerated }: GenerateWalletProps) {
  const [generatedWallet, setGeneratedWallet] = useState<Wallet | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [hasBackedUp, setHasBackedUp] = useState(false);
  const { toast } = useToast();

  // Auto-generate wallet on mount
  useEffect(() => {
    const generate = async () => {
      try {
        const wallet = await generateWallet();
        setGeneratedWallet(wallet);
      } catch {
        toast({ title: "Error", description: "Generation failed", variant: "destructive" });
      } finally {
        setIsGenerating(false);
      }
    };
    generate();
  }, [toast]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: `${label} copied` });
    } catch {
      toast({ title: "Error", description: "Copy failed", variant: "destructive" });
    }
  };

  const handleSaveWallet = () => {
    if (!generatedWallet || !hasBackedUp) return;
    onWalletGenerated(generatedWallet);
  };

  const handleRegenerate = async () => {
    setIsGenerating(true);
    setHasBackedUp(false);
    try {
      const wallet = await generateWallet();
      setGeneratedWallet(wallet);
    } catch {
      toast({ title: "Error", description: "Generation failed", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  if (isGenerating) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">Generating wallet...</p>
        </CardContent>
      </Card>
    );
  }

  if (!generatedWallet) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">Failed to generate wallet</p>
          <Button onClick={handleRegenerate}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Backup Your Wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Address */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Address</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
              {generatedWallet.address}
            </div>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedWallet.address, 'Address')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mnemonic */}
        {generatedWallet.mnemonic && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Mnemonic Phrase</label>
            <div className="p-3 bg-muted rounded">
              <div className="grid grid-cols-3 gap-2">
                {generatedWallet.mnemonic.split(' ').map((word, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Badge variant="outline" className="w-6 h-5 text-xs justify-center">{i + 1}</Badge>
                    <span className="font-mono text-xs">{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedWallet.mnemonic!, 'Mnemonic')} className="w-full">
              <Copy className="h-4 w-4 mr-2" />Copy Mnemonic
            </Button>
          </div>
        )}

        {/* Private Key */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Private Key</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
              {generatedWallet.privateKey}
            </div>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedWallet.privateKey, 'Private Key')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Backup Confirmation */}
        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="backup-confirm"
            checked={hasBackedUp}
            onChange={(e) => setHasBackedUp(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="backup-confirm" className="text-sm">I have backed up my wallet</label>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={handleRegenerate} className="flex-1">
            Generate Another
          </Button>
          <Button onClick={handleSaveWallet} disabled={!hasBackedUp} className="flex-1">
            Continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
