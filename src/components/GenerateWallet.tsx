import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Loader2, Eye, EyeOff } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { generateWallet } from '../utils/wallet';
import { useToast } from '@/hooks/use-toast';

interface GenerateWalletProps {
  onWalletGenerated: (wallet: Wallet) => void;
  isCompact?: boolean;
}

const CLIPBOARD_CLEAR_DELAY = 30000;

export function GenerateWallet({ onWalletGenerated, isCompact = false }: GenerateWalletProps) {
  const [generatedWallet, setGeneratedWallet] = useState<Wallet | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [hasBackedUp, setHasBackedUp] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const { toast } = useToast();
  const clipboardTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  useEffect(() => {
    return () => {
      if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
    };
  }, []);


  const copyToClipboard = async (text: string, label: string, isSensitive = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isSensitive) {
        if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
        clipboardTimeoutRef.current = setTimeout(async () => {
          try { await navigator.clipboard.writeText(''); } catch { /* ignore */ }
        }, CLIPBOARD_CLEAR_DELAY);
        toast({ title: "Copied!", description: `${label} (clears in 30s)` });
      } else {
        toast({ title: "Copied!", description: label });
      }
    } catch {
      toast({ title: "Error", description: "Copy failed", variant: "destructive" });
    }
  };

  const handleSaveWallet = () => {
    if (!generatedWallet || !hasBackedUp) return;
    navigator.clipboard.writeText('').catch(() => {});
    if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
    onWalletGenerated(generatedWallet);
  };

  const handleRegenerate = async () => {
    setIsGenerating(true);
    setHasBackedUp(false);
    setShowMnemonic(false);
    setShowPrivateKey(false);
    try {
      const wallet = await generateWallet();
      setGeneratedWallet(wallet);
    } catch {
      toast({ title: "Error", description: "Generation failed", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const maskText = (text: string) => '•'.repeat(Math.min(text.length, 32));

  if (isGenerating) {
    return (
      <div className={`flex flex-col items-center justify-center ${isCompact ? 'py-4' : 'py-12'}`}>
        <Loader2 className={`${isCompact ? 'h-5 w-5 mb-2' : 'h-8 w-8 mb-4'} animate-spin text-primary`} />
        <p className={`${isCompact ? 'text-xs' : 'text-sm'} text-muted-foreground`}>Generating...</p>
      </div>
    );
  }

  if (!generatedWallet) {
    return (
      <div className={`text-center ${isCompact ? 'py-4' : 'py-8'}`}>
        <p className={`${isCompact ? 'text-xs mb-2' : 'text-sm mb-4'} text-muted-foreground`}>Failed to generate</p>
        <Button onClick={handleRegenerate} size={isCompact ? 'sm' : 'default'}>Try Again</Button>
      </div>
    );
  }


  // Compact mode for popup
  if (isCompact) {
    return (
      <div className="space-y-3">
        {/* Address */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Address</span>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(generatedWallet.address, 'Address')} className="h-6 w-6 p-0">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <div className="p-2 bg-muted rounded text-xs font-mono break-all">{generatedWallet.address}</div>
        </div>

        {/* Mnemonic */}
        {generatedWallet.mnemonic && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Mnemonic</span>
              <div className="flex gap-1">
                {showMnemonic && (
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(generatedWallet.mnemonic!, 'Mnemonic', true)} className="h-6 w-6 p-0">
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setShowMnemonic(!showMnemonic)} className="h-6 w-6 p-0">
                  {showMnemonic ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
            </div>
            <div className="p-2 bg-muted rounded">
              {showMnemonic ? (
                <div className="grid grid-cols-4 gap-1">
                  {generatedWallet.mnemonic.split(' ').map((word, i) => (
                    <span key={i} className="text-[10px] font-mono">
                      <span className="text-muted-foreground">{i + 1}.</span>{word}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-center text-muted-foreground py-1">Click eye to show</p>
              )}
            </div>
          </div>
        )}

        {/* Private Key */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Private Key</span>
            <div className="flex gap-1">
              {showPrivateKey && (
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(generatedWallet.privateKey, 'Key', true)} className="h-6 w-6 p-0">
                  <Copy className="h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowPrivateKey(!showPrivateKey)} className="h-6 w-6 p-0">
                {showPrivateKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            </div>
          </div>
          <div className="p-2 bg-muted rounded text-xs font-mono break-all">
            {showPrivateKey ? generatedWallet.privateKey : maskText(generatedWallet.privateKey)}
          </div>
        </div>

        {/* Backup checkbox */}
        <div className="flex items-center gap-2 pt-1">
          <input type="checkbox" id="backup-confirm-compact" checked={hasBackedUp} onChange={(e) => setHasBackedUp(e.target.checked)} className="h-3.5 w-3.5 rounded" />
          <label htmlFor="backup-confirm-compact" className="text-xs">I have backed up my wallet</label>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRegenerate} size="sm" className="flex-1 h-8 text-xs">Regenerate</Button>
          <Button onClick={handleSaveWallet} disabled={!hasBackedUp} size="sm" className="flex-1 h-8 text-xs">Continue</Button>
        </div>
      </div>
    );
  }


  // Normal mode
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Backup Your Wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Address</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">{generatedWallet.address}</div>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedWallet.address, 'Address')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {generatedWallet.mnemonic && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Mnemonic Phrase</label>
              <Button variant="ghost" size="sm" onClick={() => setShowMnemonic(!showMnemonic)} className="h-6 px-2">
                {showMnemonic ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                <span className="ml-1 text-xs">{showMnemonic ? 'Hide' : 'Show'}</span>
              </Button>
            </div>
            <div className="p-3 bg-muted rounded">
              {showMnemonic ? (
                <div className="grid grid-cols-3 gap-2">
                  {generatedWallet.mnemonic.split(' ').map((word, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Badge variant="outline" className="w-6 h-5 text-xs justify-center">{i + 1}</Badge>
                      <span className="font-mono text-xs">{word}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground text-sm py-2">Click "Show" to reveal mnemonic phrase</div>
              )}
            </div>
            {showMnemonic && (
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedWallet.mnemonic!, 'Mnemonic', true)} className="w-full">
                <Copy className="h-4 w-4 mr-2" />Copy Mnemonic
              </Button>
            )}
          </div>
        )}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Private Key</label>
            <Button variant="ghost" size="sm" onClick={() => setShowPrivateKey(!showPrivateKey)} className="h-6 px-2">
              {showPrivateKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span className="ml-1 text-xs">{showPrivateKey ? 'Hide' : 'Show'}</span>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
              {showPrivateKey ? generatedWallet.privateKey : maskText(generatedWallet.privateKey)}
            </div>
            {showPrivateKey && (
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedWallet.privateKey, 'Private Key', true)}>
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <input type="checkbox" id="backup-confirm" checked={hasBackedUp} onChange={(e) => setHasBackedUp(e.target.checked)} className="rounded" />
          <label htmlFor="backup-confirm" className="text-sm">I have backed up my wallet</label>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleRegenerate} className="flex-1">Generate Another</Button>
          <Button onClick={handleSaveWallet} disabled={!hasBackedUp} className="flex-1">Continue</Button>
        </div>
      </CardContent>
    </Card>
  );
}
