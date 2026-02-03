import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Copy, ExternalLink, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export type TransactionStatus = 'idle' | 'sending' | 'success' | 'error';

export interface TransactionResult {
  hash?: string;
  amount?: string;
  error?: string;
}

// Bouncing Logo Animation for loading state
const BouncingLogo = ({ size = 80 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 50 50"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="animate-bounce"
    style={{ animationDuration: '0.8s' }}
  >
    <circle
      cx="25"
      cy="25"
      r="21"
      stroke="#3A4DFF"
      strokeWidth="8"
      fill="none"
    />
    <circle cx="25" cy="25" r="9" fill="#3A4DFF" />
  </svg>
);

interface TransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: TransactionStatus;
  result: TransactionResult;
  type: 'send' | 'transfer' | 'claim' | 'encrypt' | 'decrypt';
  onClose?: () => void;
  isPopupMode?: boolean;
}

export function TransactionModal({
  open,
  onOpenChange,
  status,
  result,
  type,
  onClose: _onClose,
  isPopupMode = false
}: TransactionModalProps) {
  const [copied, setCopied] = useState(false);
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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Error", description: "Failed to copy", variant: "destructive" });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Note: onClose is intentionally NOT called here
    // onClose is meant for closing the parent modal/form, not the transaction result modal
  };

  const truncateHash = (hash: string) => `${hash.slice(0, 12)}...${hash.slice(-12)}`;

  return (
    <Dialog open={open} onOpenChange={status === 'sending' ? undefined : onOpenChange}>
      <DialogContent className={isPopupMode ? "w-[320px] p-4" : "sm:max-w-md"} onPointerDownOutside={(e) => status === 'sending' && e.preventDefault()}>
        <VisuallyHidden>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>Transaction status dialog</DialogDescription>
        </VisuallyHidden>
        <div className={`flex flex-col items-center justify-center ${isPopupMode ? 'py-3 space-y-3' : 'py-6 space-y-4'}`}>
          {/* Loading State */}
          {status === 'sending' && (
            <>
              <BouncingLogo size={isPopupMode ? 56 : 80} />
              <div className="text-center space-y-1">
                <h3 className={`font-semibold ${isPopupMode ? 'text-sm' : 'text-lg'}`}>{getTitle()}</h3>
                <p className={`text-muted-foreground ${isPopupMode ? 'text-xs' : 'text-sm'}`}>{getLoadingText()}</p>
              </div>
            </>
          )}

          {/* Success State */}
          {status === 'success' && (
            <>
              <div className="relative">
                <div className={`${isPopupMode ? 'w-14 h-14' : 'w-20 h-20'} rounded-full bg-[#3A4DFF]/10 dark:bg-[#3A4DFF]/20 flex items-center justify-center animate-in zoom-in-50 duration-300`}>
                  <CheckCircle className={`${isPopupMode ? 'w-8 h-8' : 'w-12 h-12'} text-[#3A4DFF]`} />
                </div>
              </div>
              <div className="text-center space-y-1 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
                <h3 className={`font-semibold text-[#3A4DFF] ${isPopupMode ? 'text-sm' : 'text-lg'}`}>Success!</h3>
                <p className={`text-muted-foreground ${isPopupMode ? 'text-xs' : 'text-sm'}`}>{getSuccessText()}</p>
              </div>
              
              {/* Transaction Hash */}
              {result.hash && (
                <div className="w-full space-y-1.5 animate-in fade-in-50 slide-in-from-bottom-4 duration-500 delay-150">
                  <div className={`text-muted-foreground text-center ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>Transaction Hash</div>
                  <div className={`flex items-center gap-1.5 bg-muted  ${isPopupMode ? 'p-2' : 'p-3'}`}>
                    <code className={`flex-1 font-mono break-all ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>{truncateHash(result.hash)}</code>
                    <Button variant="ghost" size="sm" className={isPopupMode ? "h-6 w-6 p-0" : "h-8 w-8 p-0"} onClick={() => copyToClipboard(result.hash!)}>
                      {copied ? <Check className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} text-[#3A4DFF]`} /> : <Copy className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />}
                    </Button>
                    <Button variant="ghost" size="sm" className={isPopupMode ? "h-6 w-6 p-0" : "h-8 w-8 p-0"} asChild>
                      <a href={`https://octrascan.io/transactions/${result.hash}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />
                      </a>
                    </Button>
                  </div>
                </div>
              )}

              {/* Amount if available */}
              {result.amount && (
                <div className="animate-in fade-in-50 slide-in-from-bottom-4 duration-500 delay-200">
                  <div className={`font-bold ${isPopupMode ? 'text-lg' : 'text-2xl'} ${
                    type === 'send' || type === 'transfer' || type === 'encrypt'
                      ? 'text-red-600' 
                      : 'text-[#3A4DFF]'
                  }`}>
                    {type === 'send' || type === 'transfer' || type === 'encrypt' ? '- ' : '+ '}
                    {result.amount} OCT
                  </div>
                </div>
              )}

              <Button onClick={handleClose} className={`bg-[#3A4DFF] hover:bg-[#6C63FF]/90 ${isPopupMode ? 'mt-2 h-8 text-xs' : 'mt-4'}`}>
                Close
              </Button>
            </>
          )}

          {/* Error State */}
          {status === 'error' && (
            <>
              <div className="relative">
                <div className={`${isPopupMode ? 'w-14 h-14' : 'w-20 h-20'} rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300`}>
                  <XCircle className={`${isPopupMode ? 'w-8 h-8' : 'w-12 h-12'} text-red-600 dark:text-red-400`} />
                </div>
              </div>
              <div className="text-center space-y-1 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
                <h3 className={`font-semibold text-red-600 dark:text-red-400 ${isPopupMode ? 'text-sm' : 'text-lg'}`}>Failed</h3>
                <p className={`text-muted-foreground ${isPopupMode ? 'text-xs' : 'text-sm'}`}>Transaction failed</p>
              </div>
              
              {/* Error Message */}
              {result.error && (
                <div className="w-full animate-in fade-in-50 slide-in-from-bottom-4 duration-500 delay-150">
                  <div className={`bg-red-50 dark:bg-red-900/20  border border-red-200 dark:border-red-800 ${isPopupMode ? 'p-2' : 'p-3'}`}>
                    <p className={`text-red-600 dark:text-red-400 break-all ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>{result.error}</p>
                  </div>
                </div>
              )}

              <Button onClick={handleClose} variant="outline" className={isPopupMode ? "mt-2 h-8 text-xs" : "mt-4"}>
                Close
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
