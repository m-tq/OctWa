import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Copy, ExternalLink, Check, Clock, ArrowRight, Lock, Unlock, Gift, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export type TransactionStatus = 'idle' | 'sending' | 'success' | 'error';

export interface TransactionResult {
  hash?: string;
  amount?: string;
  error?: string;
  finality?: 'pending' | 'confirmed' | 'rejected';
}

interface TransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: TransactionStatus;
  result: TransactionResult;
  type: 'send' | 'transfer' | 'claim' | 'encrypt' | 'decrypt';
  onClose?: () => void;
  isPopupMode?: boolean;
  fromAddress?: string;
  toAddress?: string;
}

export function TransactionModal({
  open,
  onOpenChange,
  status,
  result,
  type,
  onClose: _onClose,
  isPopupMode = false,
  fromAddress,
  toAddress
}: TransactionModalProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const scannerUrl = import.meta.env.VITE_SCANNER_URL || 'https://octrascan.io/transactions/';

  const truncateAddress = (address: string) => `${address.slice(0, 8)}...${address.slice(-5)}`;

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

  const getAccent = () => {
    switch (type) {
      case 'transfer':
        return {
          text: 'text-[#00E5C0]',
          border: 'border-[#00E5C0]/20',
          bg: 'bg-[#00E5C0]/10',
          ring: 'border-[#00E5C0]',
          button: 'bg-[#00E5C0] hover:bg-[#00E5C0]/90'
        };
      case 'encrypt':
        return {
          text: 'text-[#00E5C0]',
          border: 'border-[#00E5C0]/20',
          bg: 'bg-[#00E5C0]/10',
          ring: 'border-[#00E5C0]',
          button: 'bg-[#00E5C0] hover:bg-[#00E5C0]/90'
        };
      case 'decrypt':
        return {
          text: 'text-muted-foreground',
          border: 'border-border',
          bg: 'bg-muted',
          ring: 'border-muted-foreground',
          button: 'bg-muted text-muted-foreground hover:bg-muted/80'
        };
      case 'claim':
        return {
          text: 'text-emerald-500',
          border: 'border-emerald-500/20',
          bg: 'bg-emerald-500/10',
          ring: 'border-emerald-500',
          button: 'bg-emerald-500 hover:bg-emerald-500/90'
        };
      default:
        return {
          text: 'text-[#3A4DFF]',
          border: 'border-[#3A4DFF]/20',
          bg: 'bg-[#3A4DFF]/10',
          ring: 'border-[#3A4DFF]',
          button: 'bg-[#3A4DFF] hover:bg-[#6C63FF]/90'
        };
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
  };

  const truncateHash = (hash: string) => `${hash.slice(0, 12)}...${hash.slice(-12)}`;

  if (!open) {
    return null;
  }

  const accent = getAccent();
  const fromLabel = fromAddress ? truncateAddress(fromAddress) : 'sender';
  const toLabel = toAddress ? truncateAddress(toAddress) : 'recipient';
  const sizeTitle = isPopupMode ? 'text-sm' : 'text-lg';
  const sizeText = isPopupMode ? 'text-xs' : 'text-sm';

  return (
    <div className={`border rounded-lg ${accent.border} ${isPopupMode ? 'p-3' : 'p-4'} space-y-4`}>
      <div className="flex items-center justify-between">
        <div className={`font-semibold ${sizeTitle}`}>{getTitle()}</div>
        <Button variant="ghost" size="icon" onClick={handleClose} className={isPopupMode ? 'h-7 w-7' : 'h-8 w-8'}>
          <X className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
        </Button>
      </div>

      {status === 'sending' && (
        <div className="flex flex-col items-center gap-3">
          {(type === 'send' || type === 'transfer') && (
            <div className="flex items-center gap-2">
              <span className={`font-mono ${sizeText} text-muted-foreground`}>{fromLabel}</span>
              <div className="flex items-center gap-1">
                <span className={`h-px w-6 ${accent.bg} animate-pulse`} />
                {type === 'transfer' && <Lock className={`${accent.text} h-3 w-3`} />}
                <span className={`h-px w-6 ${accent.bg} animate-pulse`} />
                <ArrowRight className={`${accent.text} h-3 w-3 animate-pulse`} />
              </div>
              <span className={`font-mono ${sizeText} ${accent.text}`}>{toLabel}</span>
            </div>
          )}

          {(type === 'encrypt' || type === 'decrypt') && (
            <div className="relative h-16 w-16">
              <div className={`absolute inset-0 rounded-full border-2 border-dashed ${accent.ring} animate-spin`} />
              <div className={`absolute inset-2 rounded-full border-2 ${accent.ring} opacity-40`} />
              <div className="absolute inset-0 flex items-center justify-center">
                {type === 'encrypt' ? (
                  <Lock className={`${accent.text} h-6 w-6`} />
                ) : (
                  <Unlock className={`${accent.text} h-6 w-6`} />
                )}
              </div>
            </div>
          )}

          {type === 'claim' && (
            <div className="relative h-16 w-16">
              <div className={`absolute inset-0 rounded-full border-2 border-dashed ${accent.ring} animate-spin`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Gift className={`${accent.text} h-6 w-6`} />
              </div>
            </div>
          )}

          <div className="text-center">
            <div className={`font-medium ${sizeText}`}>{getLoadingText()}</div>
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center gap-3">
          <div className={`${isPopupMode ? 'w-12 h-12' : 'w-16 h-16'} rounded-full ${accent.bg} flex items-center justify-center`}>
            <CheckCircle className={`${accent.text} ${isPopupMode ? 'w-6 h-6' : 'w-8 h-8'}`} />
          </div>
          <div className="text-center space-y-1">
            <div className={`font-semibold ${accent.text} ${sizeTitle}`}>Success</div>
            <div className={`text-muted-foreground ${sizeText}`}>{getSuccessText()}</div>
          </div>

          {result.hash && (
            <div className="w-full space-y-1">
              <div className={`text-muted-foreground text-center ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>Transaction Hash</div>
              <div className={`flex items-center gap-1.5 bg-muted ${isPopupMode ? 'p-2' : 'p-3'}`}>
                <code className={`flex-1 font-mono break-all ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>{truncateHash(result.hash)}</code>
                <Button variant="ghost" size="sm" className={isPopupMode ? "h-6 w-6 p-0" : "h-8 w-8 p-0"} onClick={() => copyToClipboard(result.hash!)}>
                  {copied ? <Check className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} ${accent.text}`} /> : <Copy className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />}
                </Button>
                <Button variant="ghost" size="sm" className={isPopupMode ? "h-6 w-6 p-0" : "h-8 w-8 p-0"} asChild>
                  <a href={`${scannerUrl}${result.hash}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />
                  </a>
                </Button>
              </div>

              {result.finality && (
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    result.finality === 'confirmed'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}>
                    {result.finality === 'confirmed' ? (
                      <>
                        <CheckCircle className="h-3 w-3" />
                        <span>Confirmed</span>
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3" />
                        <span>Pending</span>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {result.amount && (
            <div className={`font-bold ${isPopupMode ? 'text-lg' : 'text-2xl'} ${
              type === 'send' || type === 'transfer' || type === 'encrypt'
                ? 'text-red-600'
                : accent.text
            }`}>
              {type === 'send' || type === 'transfer' || type === 'encrypt' ? '- ' : '+ '}
              {result.amount} OCT
            </div>
          )}

          <Button onClick={handleClose} className={`${accent.button} ${isPopupMode ? 'h-8 text-xs' : ''}`}>
            Close
          </Button>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3">
          <div className={`${isPopupMode ? 'w-12 h-12' : 'w-16 h-16'} rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center`}>
            <XCircle className={`${isPopupMode ? 'w-6 h-6' : 'w-8 h-8'} text-red-600 dark:text-red-400`} />
          </div>
          <div className="text-center space-y-1">
            <div className={`font-semibold text-red-600 dark:text-red-400 ${sizeTitle}`}>Failed</div>
            <div className={`text-muted-foreground ${sizeText}`}>Transaction failed</div>
          </div>
          {result.error && (
            <div className="w-full">
              <div className={`bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 ${isPopupMode ? 'p-2' : 'p-3'}`}>
                <p className={`text-red-600 dark:text-red-400 break-all ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>{result.error}</p>
              </div>
            </div>
          )}
          <Button onClick={handleClose} variant="outline" className={isPopupMode ? "h-8 text-xs" : ""}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
