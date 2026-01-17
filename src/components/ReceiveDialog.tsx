import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Check, QrCode, ArrowLeft } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';

interface ReceiveDialogProps {
  wallet: Wallet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPopupMode?: boolean;
  isFullscreen?: boolean;
  onBack?: () => void;
  customAddress?: string; // For EVM mode - show EVM address instead of Octra address
  customTitle?: string; // For EVM mode - show "Receive ETH" instead of "Receive OCT"
  customInfo?: string; // For EVM mode - custom info text
}

export function ReceiveDialog({ 
  wallet, 
  open, 
  onOpenChange, 
  isPopupMode = false,
  isFullscreen = false,
  onBack,
  customAddress,
  customTitle,
  customInfo
}: ReceiveDialogProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  // Use custom address if provided (for EVM mode), otherwise use wallet address
  const displayAddress = customAddress || wallet.address;
  const title = customTitle || 'Receive OCT';
  const infoText = customInfo || 'Share this address to receive OCT tokens. Only send OCT to this address.';

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(displayAddress);
      setCopied(true);
      // Only show toast in non-fullscreen mode (expanded view)
      if (!isFullscreen) {
        toast({
          title: "Copied!",
          description: "Address copied to clipboard",
        });
      }
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy address",
        variant: "destructive",
      });
    }
  };

  const content = (
    <div className="flex flex-col items-center py-4">
      {/* QR Code - Generated offline */}
      <div className="bg-white p-4 shadow-sm border">
        <QRCodeSVG 
          value={displayAddress}
          size={192}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
        />
      </div>

      {/* Address */}
      <div className="mt-4 w-full max-w-sm px-4">
        <p className="text-xs text-muted-foreground text-center mb-2">Your Wallet Address</p>
        <div className="bg-muted/50  p-3 border">
          <p className="font-mono text-xs text-center break-all leading-relaxed">
            {displayAddress}
          </p>
        </div>
      </div>

      {/* Copy Button */}
      <Button
        onClick={copyAddress}
        className="mt-4 gap-2"
        variant={copied ? "secondary" : "default"}
      >
        {copied ? (
          <>
            <Check className="h-4 w-4" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" />
            Copy Address
          </>
        )}
      </Button>

      {/* Info */}
      <p className="text-xs text-muted-foreground text-center mt-4 max-w-xs px-4">
        {infoText}
      </p>
    </div>
  );

  // Fullscreen mode for popup
  if (isFullscreen) {
    return (
      <div className="flex flex-col h-full pb-10">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            <h2 className="font-semibold text-sm">{title}</h2>
          </div>
        </div>
        
        {/* Content - vertically centered */}
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          {content}
        </div>
      </div>
    );
  }

  // Dialog mode
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isPopupMode ? 'max-w-[360px]' : 'sm:max-w-md'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Scan QR code or copy address to receive tokens
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
