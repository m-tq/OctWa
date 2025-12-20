import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, Loader2, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { encryptBalance } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface EncryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  publicBalance: number;
  onSuccess: () => void;
}

export function EncryptBalanceDialog({ 
  open, 
  onOpenChange, 
  wallet, 
  publicBalance, 
  onSuccess 
}: EncryptBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const { toast } = useToast();

  const maxEncryptable = Math.max(0, publicBalance - 0.005); // Reserve 0.005 OCT for fees

  const handleEncrypt = async () => {
    const amountNum = parseFloat(amount);
    
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (amountNum > maxEncryptable) {
      toast({
        title: "Error",
        description: `Amount too large. Maximum: ${maxEncryptable.toFixed(6)} OCT`,
        variant: "destructive",
      });
      return;
    }

    setIsEncrypting(true);
    
    try {
      const result = await encryptBalance(wallet.address, amountNum, wallet.privateKey);
      
      if (result.success) {
        toast({
          title: "Encryption Submitted!",
          description: "Your balance encryption request has been submitted",
        });
        setAmount('');
        onSuccess();
      } else {
        toast({
          title: "Encryption Failed",
          description: result.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to encrypt balance",
        variant: "destructive",
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Encrypt Balance
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Encrypting balance converts public OCT to private OCT.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Current Public Balance</Label>
            <div className="p-3 bg-muted rounded-md font-mono">
              {publicBalance.toFixed(8)} OCT
            </div>
          </div>

          <div className="space-y-2">
            <Label>Maximum Encryptable</Label>
            <div className="p-3 bg-muted rounded-md font-mono">
              {maxEncryptable.toFixed(8)} OCT
            </div>
            <p className="text-xs text-muted-foreground">
              (0.005 OCT reserved for transaction fees)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="encrypt-amount">Amount to Encrypt</Label>
            <Input
              id="encrypt-amount"
              type="number"
              placeholder="0.00000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.1"
              min="0"
              max={maxEncryptable}
              disabled={isEncrypting}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isEncrypting}
              className="flex-1"
            >
              Cancel
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex-1">
                    <Button
                      onClick={handleEncrypt}
                      disabled={isEncrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0}
                      className="w-full"
                    >
                      {isEncrypting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Encrypting...
                        </>
                      ) : (
                        <>
                          <Lock className="h-4 w-4 mr-2" />
                          Encrypt
                        </>
                      )}
                    </Button>
                  </div>
                </TooltipTrigger>
                {(isEncrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxEncryptable || maxEncryptable <= 0) && !isEncrypting && (
                  <TooltipContent side="top" className="max-w-[250px]">
                    <p className="text-xs">
                      {maxEncryptable <= 0 
                        ? "Insufficient balance. Need at least 0.005 OCT for fees."
                        : !amount || parseFloat(amount) <= 0
                          ? "Enter an amount to encrypt"
                          : parseFloat(amount) > maxEncryptable
                            ? `Amount exceeds maximum (${maxEncryptable.toFixed(6)} OCT)`
                            : ""}
                    </p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}