import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, Copy, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export type TransactionStatus = 'idle' | 'sending' | 'success' | 'error';

export interface TransactionResult {
  hash?: string;
  amount?: string;
  error?: string;
}

interface TransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: TransactionStatus;
  result: TransactionResult;
  type: 'send' | 'transfer' | 'claim' | 'encrypt' | 'decrypt';
  onClose?: () => void;
}

export function TransactionModal({
  open,
  onOpenChange,
  status,
  result,
  type,
  onClose
}: TransactionModalProps) {
  const { toast } = useToast();

  const getTitle = () => {
    switch (type) {
      case 'send': return 'Send Transaction';
      case 'transfer': return 'Private Transfer';
      case 'claim': return 'Claim Transfer';
      case 'encrypt': return 'Encrypt Balance';
      case 'decrypt': return 'Decrypt Balance';
      default: return 'Transaction';
    }
  };

  const getLoadingText = () => {
    switch (type) {
      case 'send': return 'Sending transaction...';
      case 'transfer': return 'Processing private transfer...';
      case 'claim': return 'Claiming transfer...';
      case 'encrypt': return 'Encrypting balance...';
      case 'decrypt': return 'Decrypting balance...';
      default: return 'Processing...';
    }
  };

  const getSuccessText = () => {
    switch (type) {
      case 'send': return 'Transaction sent successfully!';
      case 'transfer': return 'Private transfer completed!';
      case 'claim': return 'Transfer claimed successfully!';
      case 'encrypt': return 'Balance encrypted successfully!';
      case 'decrypt': return 'Balance decrypted successfully!';
      default: return 'Transaction completed!';
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: "Hash copied to clipboard" });
    } catch {
      toast({ title: "Error", description: "Failed to copy", variant: "destructive" });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    onClose?.();
  };

  const truncateHash = (hash: string) => `${hash.slice(0, 12)}...${hash.slice(-12)}`;

  return (
    <Dialog open={open} onOpenChange={status === 'sending' ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => status === 'sending' && e.preventDefault()}>
        <VisuallyHidden>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>Transaction status dialog</DialogDescription>
        </VisuallyHidden>
        <div className="flex flex-col items-center justify-center py-6 space-y-4">
          {/* Loading State */}
          {status === 'sending' && (
            <>
              <div className="relative w-20 h-20">
                {/* Spinning circle border */}
                <div className="absolute inset-0 rounded-full border-4 border-[#0000db]/20" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#0000db] animate-spin" />
                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-[#0000db] animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">{getTitle()}</h3>
                <p className="text-sm text-muted-foreground">{getLoadingText()}</p>
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-[#0000db] animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </>
          )}

          {/* Success State */}
          {status === 'success' && (
            <>
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                  <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="text-center space-y-2 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
                <h3 className="text-lg font-semibold text-green-600 dark:text-green-400">Success!</h3>
                <p className="text-sm text-muted-foreground">{getSuccessText()}</p>
              </div>
              
              {/* Transaction Hash */}
              {result.hash && (
                <div className="w-full space-y-2 animate-in fade-in-50 slide-in-from-bottom-4 duration-500 delay-150">
                  <div className="text-xs text-muted-foreground text-center">Transaction Hash</div>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <code className="flex-1 text-xs font-mono break-all">{truncateHash(result.hash)}</code>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => copyToClipboard(result.hash!)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                      <a href={`https://octrascan.io/transactions/${result.hash}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              )}

              {/* Amount if available */}
              {result.amount && (
                <div className="animate-in fade-in-50 slide-in-from-bottom-4 duration-500 delay-200">
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {result.amount} OCT
                  </Badge>
                </div>
              )}

              <Button onClick={handleClose} className="mt-4 bg-[#0000db] hover:bg-[#0000db]/90">
                Close
              </Button>
            </>
          )}

          {/* Error State */}
          {status === 'error' && (
            <>
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                  <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
                </div>
              </div>
              <div className="text-center space-y-2 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">Failed</h3>
                <p className="text-sm text-muted-foreground">Transaction failed</p>
              </div>
              
              {/* Error Message */}
              {result.error && (
                <div className="w-full animate-in fade-in-50 slide-in-from-bottom-4 duration-500 delay-150">
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-xs text-red-600 dark:text-red-400 break-all">{result.error}</p>
                  </div>
                </div>
              )}

              <Button onClick={handleClose} variant="outline" className="mt-4">
                Close
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
