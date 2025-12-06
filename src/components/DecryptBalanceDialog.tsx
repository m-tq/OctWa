import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Unlock, Loader2, AlertTriangle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { decryptBalance } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface DecryptBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Wallet;
  encryptedBalance: number;
  onSuccess: () => void;
}

export function DecryptBalanceDialog({ 
  open, 
  onOpenChange, 
  wallet, 
  encryptedBalance, 
  onSuccess 
}: DecryptBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const { toast } = useToast();

  const handleDecrypt = async () => {
    const amountNum = parseFloat(amount);
    
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (amountNum > encryptedBalance) {
      toast({
        title: "Error",
        description: `Amount too large. Maximum: ${encryptedBalance.toFixed(6)} OCT`,
        variant: "destructive",
      });
      return;
    }

    setIsDecrypting(true);
    
    try {
      const result = await decryptBalance(wallet.address, amountNum, wallet.privateKey);
      
      if (result.success) {
        toast({
          title: "Decryption Submitted!",
          description: "Your balance decryption request has been submitted",
        });
        setAmount('');
        onSuccess();
      } else {
        toast({
          title: "Decryption Failed",
          description: result.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to decrypt balance",
        variant: "destructive",
      });
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-5 w-5" />
            Decrypt Balance
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Decrypting balance converts private OCT back to public OCT. This operation requires a transaction fee.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Current Private Balance</Label>
            <div className="p-3 bg-muted rounded-md font-mono text-yellow-600">
              {encryptedBalance.toFixed(8)} OCT
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="decrypt-amount">Amount to Decrypt</Label>
            <Input
              id="decrypt-amount"
              type="number"
              placeholder="0.00000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.1"
              min="0"
              max={encryptedBalance}
              disabled={isDecrypting}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isDecrypting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDecrypt}
              disabled={isDecrypting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > encryptedBalance}
              className="flex-1"
            >
              {isDecrypting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Decrypting...
                </>
              ) : (
                <>
                  <Unlock className="h-4 w-4 mr-2" />
                  Decrypt
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}