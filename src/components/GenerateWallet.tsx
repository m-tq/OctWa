import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Loader2, Eye, EyeOff, AlertCircle, ShieldCheck, Check } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { generateWallet } from '../utils/wallet';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface GenerateWalletProps {
  onWalletGenerated: (wallet: Wallet) => void;
  isCompact?: boolean;
  hideBorder?: boolean;
}

const CLIPBOARD_CLEAR_DELAY = 30000;

// Get random unique indices for verification
function getRandomIndices(total: number, count: number): number[] {
  const indices: number[] = [];
  while (indices.length < count) {
    const rand = Math.floor(Math.random() * total);
    if (!indices.includes(rand)) {
      indices.push(rand);
    }
  }
  return indices.sort((a, b) => a - b);
}

export function GenerateWallet({ onWalletGenerated, isCompact = false, hideBorder = false }: GenerateWalletProps) {
  const [generatedWallet, setGeneratedWallet] = useState<Wallet | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [hasBackedUp, setHasBackedUp] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = useState<Record<number, string>>({});
  const [verifyError, setVerifyError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
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


  const copyToClipboard = async (text: string, field: string, isSensitive = false) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      
      if (isSensitive) {
        if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
        clipboardTimeoutRef.current = setTimeout(async () => {
          try { await navigator.clipboard.writeText(''); } catch { /* ignore */ }
        }, CLIPBOARD_CLEAR_DELAY);
      }
    } catch {
      toast({ title: "Error", description: "Copy failed", variant: "destructive" });
    }
  };

  const handleSaveWallet = () => {
    if (!generatedWallet || !hasBackedUp) return;
    
    // Show verification modal instead of proceeding directly
    if (generatedWallet.mnemonic) {
      const words = generatedWallet.mnemonic.split(' ');
      const indices = getRandomIndices(words.length, 2);
      setVerifyIndices(indices);
      setVerifyInputs({});
      setVerifyError('');
      setShowVerifyModal(true);
    } else {
      // No mnemonic, proceed directly
      proceedToPassword();
    }
  };

  const proceedToPassword = () => {
    if (!generatedWallet) return;
    navigator.clipboard.writeText('').catch(() => {});
    if (clipboardTimeoutRef.current) clearTimeout(clipboardTimeoutRef.current);
    onWalletGenerated(generatedWallet);
  };

  const handleVerifyBackup = () => {
    if (!generatedWallet?.mnemonic) return;
    
    const words = generatedWallet.mnemonic.split(' ');
    let allCorrect = true;
    
    for (const idx of verifyIndices) {
      const input = (verifyInputs[idx] || '').trim().toLowerCase();
      if (input !== words[idx].toLowerCase()) {
        allCorrect = false;
        break;
      }
    }
    
    if (allCorrect) {
      setShowVerifyModal(false);
      proceedToPassword();
    } else {
      setVerifyError('Incorrect words. Please check your backup and try again.');
    }
  };

  const handleCancelVerify = () => {
    setShowVerifyModal(false);
    setVerifyInputs({});
    setVerifyError('');
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

  const handleVerifyInputChange = (idx: number, value: string) => {
    setVerifyInputs(prev => ({ ...prev, [idx]: value }));
    setVerifyError('');
  };

  // Copy button component with check icon feedback
  const CopyButton = ({ field, text, isSensitive = false, size = 'sm' }: { field: string; text: string; isSensitive?: boolean; size?: 'sm' | 'default' }) => (
    <Button 
      variant={size === 'sm' ? 'ghost' : 'outline'} 
      size="sm" 
      onClick={() => copyToClipboard(text, field, isSensitive)} 
      className={size === 'sm' ? 'h-6 w-6 p-0' : ''}
    >
      {copiedField === field ? (
        <Check className={`${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} text-green-500`} />
      ) : (
        <Copy className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
      )}
    </Button>
  );

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
      <>
        <Dialog open={showVerifyModal} onOpenChange={setShowVerifyModal}>
          <DialogContent className="w-[90vw] max-w-[320px] p-4 z-[10001]" overlayClassName="z-[10000]">
            <DialogHeader className="pb-2">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Verify Backup
              </DialogTitle>
              <DialogDescription className="text-xs">
                Enter the words below to confirm your backup.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {verifyIndices.map((idx) => (
                <div key={idx} className="space-y-1">
                  <Label htmlFor={`word-compact-${idx}`} className="text-xs">Word #{idx + 1}</Label>
                  <Input
                    id={`word-compact-${idx}`}
                    placeholder={`Word #${idx + 1}`}
                    value={verifyInputs[idx] || ''}
                    onChange={(e) => handleVerifyInputChange(idx, e.target.value)}
                    className={`h-8 text-xs ${verifyError ? 'border-destructive' : ''}`}
                  />
                </div>
              ))}
              {verifyError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {verifyError}
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={handleCancelVerify} size="sm" className="flex-1 h-8 text-xs">
                Cancel
              </Button>
              <Button onClick={handleVerifyBackup} size="sm" className="flex-1 h-8 text-xs">
                Verify
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <div className="space-y-3">
        {/* Address */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Address</span>
            <CopyButton field="address-compact" text={generatedWallet.address} />
          </div>
          <div className="p-2 border border-border rounded text-xs font-mono break-all">{generatedWallet.address}</div>
        </div>

        {/* Mnemonic */}
        {generatedWallet.mnemonic && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Mnemonic</span>
              <div className="flex gap-1">
                {showMnemonic && (
                  <CopyButton field="mnemonic-compact" text={generatedWallet.mnemonic} isSensitive />
                )}
                <Button variant="ghost" size="sm" onClick={() => setShowMnemonic(!showMnemonic)} className="h-6 w-6 p-0">
                  {showMnemonic ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
            </div>
            <div className="p-2 border border-border rounded">
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
                <CopyButton field="privatekey-compact" text={generatedWallet.privateKey} isSensitive />
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowPrivateKey(!showPrivateKey)} className="h-6 w-6 p-0">
                {showPrivateKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            </div>
          </div>
          <div className="p-2 border border-border rounded text-xs font-mono break-all">
            {showPrivateKey ? generatedWallet.privateKey : maskText(generatedWallet.privateKey)}
          </div>
        </div>

        {/* Backup checkbox */}
        <label htmlFor="backup-confirm-compact" className="flex items-center gap-2 pt-1 cursor-pointer select-none">
          <input type="checkbox" id="backup-confirm-compact" checked={hasBackedUp} onChange={(e) => setHasBackedUp(e.target.checked)} className="h-3.5 w-3.5 rounded accent-primary" style={{ cursor: 'pointer' }} />
          <span className="text-xs">I have backed up my wallet</span>
        </label>

        {/* Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRegenerate} size="sm" className="flex-1 h-8 text-xs">Regenerate</Button>
          <Button onClick={handleSaveWallet} disabled={!hasBackedUp} size="sm" className="flex-1 h-8 text-xs">Continue</Button>
        </div>
      </div>
      </>
    );
  }


  // Normal mode
  return (
    <>
      <Dialog open={showVerifyModal} onOpenChange={setShowVerifyModal}>
        <DialogContent className="sm:max-w-md z-[10001]" overlayClassName="z-[10000]">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Are you sure you have a backup?
            </DialogTitle>
            <DialogDescription>
              Please enter the following words from your mnemonic phrase to verify your backup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 pr-8">
            {verifyIndices.map((idx) => (
              <div key={idx} className="space-y-2">
                <Label htmlFor={`word-${idx}`}>Word {idx + 1}</Label>
                <Input
                  id={`word-${idx}`}
                  placeholder={`Enter word #${idx + 1}`}
                  value={verifyInputs[idx] || ''}
                  onChange={(e) => handleVerifyInputChange(idx, e.target.value)}
                  className={verifyError ? 'border-destructive' : ''}
                />
              </div>
            ))}
            {verifyError && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {verifyError}
              </p>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-2 pr-8">
            <Button variant="outline" onClick={handleCancelVerify} className="flex-1 text-xs sm:text-sm">
              I don't have a backup yet
            </Button>
            <Button onClick={handleVerifyBackup} className="flex-1">
              Verify Backup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Card className={`${hideBorder ? 'bg-transparent border-0 shadow-none' : 'bg-card/95 backdrop-blur-sm'}`}>
      {!hideBorder && (
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Backup Your Wallet</CardTitle>
        </CardHeader>
      )}
      <CardContent className={`space-y-4 ${hideBorder ? 'p-0' : ''}`}>
        <div className="space-y-2">
          <label className="text-sm font-medium">Address</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2 border border-border rounded text-xs font-mono break-all">{generatedWallet.address}</div>
            <CopyButton field="address" text={generatedWallet.address} size="default" />
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
            <div className="p-3 border border-border rounded">
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
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => copyToClipboard(generatedWallet.mnemonic!, 'mnemonic', true)} 
                className="w-full"
              >
                {copiedField === 'mnemonic' ? (
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Copy Mnemonic
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
            <div className="flex-1 p-2 border border-border rounded text-xs font-mono break-all">
              {showPrivateKey ? generatedWallet.privateKey : maskText(generatedWallet.privateKey)}
            </div>
            {showPrivateKey && (
              <CopyButton field="privatekey" text={generatedWallet.privateKey} isSensitive size="default" />
            )}
          </div>
        </div>
        <label htmlFor="backup-confirm" className="flex items-center gap-2 pt-2 cursor-pointer select-none">
          <input type="checkbox" id="backup-confirm" checked={hasBackedUp} onChange={(e) => setHasBackedUp(e.target.checked)} className="rounded accent-primary" style={{ cursor: 'pointer' }} />
          <span className="text-sm">I have backed up my wallet</span>
        </label>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleRegenerate} className="flex-1">Generate Another</Button>
          <Button onClick={handleSaveWallet} disabled={!hasBackedUp} className="flex-1">Continue</Button>
        </div>
      </CardContent>
    </Card>
    </>
  );
}
