import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Send, AlertTriangle, Wallet as WalletIcon, CheckCircle, MessageSquare, Calculator, Settings2 } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance, sendTransaction, createTransaction } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { AnimatedIcon } from './AnimatedIcon';

// Threshold for confirmation dialog (500 OCT)
const LARGE_TRANSACTION_THRESHOLD = 500;

interface SendTransactionProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  onBalanceUpdate: (balance: number) => void;
  onNonceUpdate: (nonce: number) => void;
  onTransactionSuccess: () => void;
  onModalClose?: () => void; // Called when transaction result modal is closed
  isCompact?: boolean;
}

// Simple address validation function
function isOctraAddress(input: string): boolean {
  // Check if it's a valid Octra address: exactly 47 characters starting with "oct"
  const addressRegex = /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/;
  return addressRegex.test(input);
}

function validateRecipientInput(input: string): { isValid: boolean; error?: string } {
  if (!input || input.trim().length === 0) {
    return { isValid: false, error: 'Address is required' };
  }

  const trimmedInput = input.trim();

  // Check if it's a valid Octra address
  if (isOctraAddress(trimmedInput)) {
    return { isValid: true };
  }

  return { 
    isValid: false, 
    error: 'Invalid address format. Must be exactly 47 characters starting with "oct"'
  };
}

export function SendTransaction({ wallet, balance, nonce, onBalanceUpdate, onNonceUpdate, onTransactionSuccess, onModalClose, isCompact = false }: SendTransactionProps) {
  const [recipientAddress, setRecipientAddress] = useState('');
  const [addressValidation, setAddressValidation] = useState<{ isValid: boolean; error?: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const { toast } = useToast();

  // Get OU value based on selection
  const getOuValue = (): number => {
    if (ouOption === 'auto') {
      // Auto: 10000 for < 1000 OCT, 30000 for >= 1000 OCT
      const amountNum = parseFloat(amount) || 0;
      return amountNum < 1000 ? 10000 : 30000;
    }
    if (ouOption === 'custom') return parseInt(customOu) || 10000;
    return parseInt(ouOption) || 10000;
  };

  // Validate recipient address when input changes
  useEffect(() => {
    if (!recipientAddress.trim()) {
      setAddressValidation(null);
      return;
    }

    const validation = validateRecipientInput(recipientAddress);
    setAddressValidation(validation);
  }, [recipientAddress]);

  const validateAmount = (amountStr: string) => {
    const num = parseFloat(amountStr);
    return !isNaN(num) && num > 0;
  };

  // Calculate fee based on OU (gas)
  // Fee formula: OU * 0.0000001 (1 OU = 0.0000001 OCT)
  const calculateFee = (): number => {
    const ou = getOuValue();
    return ou * 0.0000001;
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

  // Pre-validation before showing confirmation or sending
  const validateBeforeSend = (): boolean => {
    if (!wallet) {
      toast({
        title: "Error",
        description: "No wallet connected",
        variant: "destructive",
      });
      return false;
    }

    const validation = validateRecipientInput(recipientAddress);
    if (!validation.isValid) {
      toast({
        title: "Error",
        description: validation.error || "Invalid recipient address",
        variant: "destructive",
      });
      return false;
    }

    if (!validateAmount(amount)) {
      toast({
        title: "Error",
        description: "Invalid amount",
        variant: "destructive",
      });
      return false;
    }

    const amountNum = parseFloat(amount);
    const fee = calculateFee();
    const totalCost = amountNum + fee;

    if (balance !== null && totalCost > balance) {
      toast({
        title: "Error",
        description: `Insufficient balance. Need ${totalCost.toFixed(8)} OCT (${amountNum.toFixed(8)} + ${fee.toFixed(8)} fee)`,
        variant: "destructive",
      });
      return false;
    }

    if (message && message.length > 1024) {
      toast({
        title: "Error",
        description: "Message too long (max 1024 characters)",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  // Handle send button click - show confirmation for large amounts
  const handleSendClick = () => {
    if (!validateBeforeSend()) return;
    
    const amountNum = parseFloat(amount);
    
    // Show confirmation dialog for large transactions (>= 500 OCT)
    if (amountNum >= LARGE_TRANSACTION_THRESHOLD) {
      setShowConfirmDialog(true);
    } else {
      executeSend();
    }
  };

  // Execute the actual send transaction
  const executeSend = async () => {
    if (!wallet) return;
    
    setShowConfirmDialog(false);
    setIsSending(true);
    
    // Show modal with sending state
    setTxModalStatus('sending');
    setTxModalResult({});
    setShowTxModal(true);

    const amountNum = parseFloat(amount);

    try {
      // Refresh nonce before sending like CLI does
      const freshBalanceData = await fetchBalance(wallet.address);
      const currentNonce = freshBalanceData.nonce;

      const transaction = createTransaction(
        wallet.address,
        recipientAddress.trim(),
        amountNum,
        currentNonce + 1,
        wallet.privateKey,
        wallet.publicKey || '',
        message || undefined,
        getOuValue()
      );

      const sendResult = await sendTransaction(transaction);

      if (sendResult.success) {
        // Update modal to success state
        setTxModalStatus('success');
        setTxModalResult({ hash: sendResult.hash, amount: amountNum.toFixed(8) });
        
        // Reset OU to auto on success
        setOuOption('auto');
        setCustomOu('');

        // Reset form
        setRecipientAddress('');
        setAmount('');
        setMessage('');

        // Update nonce
        onNonceUpdate(currentNonce + 1);

        // Update balance after successful transaction
        setTimeout(async () => {
          try {
            const updatedBalance = await fetchBalance(wallet.address);
            onBalanceUpdate(updatedBalance.balance);
            onNonceUpdate(updatedBalance.nonce);
          } catch (error) {
            console.error('Failed to refresh balance after transaction:', error);
          }
        }, 2000);

        onTransactionSuccess();
      } else {
        const errorMsg = sendResult.error || "Unknown error occurred";
        // Update modal to error state
        setTxModalStatus('error');
        setTxModalResult({ error: errorMsg });
      }
    } catch (error) {
      console.error('Send transaction error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      // Update modal to error state
      setTxModalStatus('error');
      setTxModalResult({ error: errorMsg });
    } finally {
      setIsSending(false);
    }
  };

  if (!wallet) {
    return (
      <Alert>
        <div className="flex items-start space-x-3">
          <WalletIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <AlertDescription>
            No wallet available. Please generate or import a wallet first.
          </AlertDescription>
        </div>
      </Alert>
    );
  }

  const amountNum = parseFloat(amount) || 0;
  const fee = calculateFee();
  const totalCost = amountNum + fee;
  const currentBalance = balance || 0;

  // Compact mode for popup
  if (isCompact) {
    return (
      <div className="space-y-4">
        {/* Animated Icon */}
        <AnimatedIcon type="send-public" size="sm" />

        {/* Recipient Address */}
        <div className="space-y-1.5">
          <Label htmlFor="recipient" className="text-sm">Recipient</Label>
          <Input
            id="recipient"
            placeholder="oct..."
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            className="font-mono text-sm h-9"
          />
          {recipientAddress.trim() && addressValidation && !addressValidation.isValid && (
            <p className="text-xs text-red-600">{addressValidation.error}</p>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="amount" className="text-sm">Amount (OCT)</Label>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                Balance: <span className="font-mono">{currentBalance.toFixed(4)}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  // Calculate fee based on OU selection
                  // Fee formula: OU * 0.0000001
                  let feeForMax: number;
                  
                  if (ouOption === 'auto') {
                    // Auto mode: determine OU based on potential max amount
                    // If balance >= 1000 + fee(30000), use 30000 OU
                    // Otherwise use 10000 OU
                    const feeFor30k = 30000 * 0.0000001; // 0.003
                    const feeFor10k = 10000 * 0.0000001; // 0.001
                    
                    if (currentBalance >= 1000 + feeFor30k) {
                      feeForMax = feeFor30k;
                    } else {
                      feeForMax = feeFor10k;
                    }
                  } else if (ouOption === 'custom') {
                    const customOuValue = parseInt(customOu) || 10000;
                    feeForMax = customOuValue * 0.0000001;
                  } else {
                    feeForMax = parseInt(ouOption) * 0.0000001;
                  }
                  
                  if (currentBalance > feeForMax) {
                    const maxAmount = currentBalance - feeForMax;
                    setAmount(maxAmount.toFixed(8));
                  } else {
                    toast({
                      title: "Insufficient Balance",
                      description: `Need more than ${feeForMax.toFixed(7)} OCT to send (for fee)`,
                      variant: "destructive",
                    });
                  }
                }}
                className="text-[#0000db] hover:text-[#0000db]/80 font-medium hover:underline"
              >
                Max
              </button>
            </div>
          </div>
          <Input
            id="amount"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            step="0.1"
            min="0"
            className="text-sm h-9"
          />
        </div>

        {/* OU (Gas) */}
        <div className="space-y-1.5">
          <Label className="text-sm">OU (Gas)</Label>
          <Select value={ouOption} onValueChange={setOuOption}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-sm">Auto</SelectItem>
              <SelectItem value="10000" className="text-sm">10,000 OU</SelectItem>
              <SelectItem value="30000" className="text-sm">30,000 OU</SelectItem>
              <SelectItem value="50000" className="text-sm">50,000 OU</SelectItem>
              <SelectItem value="100000" className="text-sm">100,000 OU</SelectItem>
              <SelectItem value="custom" className="text-sm">Custom</SelectItem>
            </SelectContent>
          </Select>
          {ouOption === 'custom' && (
            <Input
              type="number"
              placeholder="Enter custom OU value"
              value={customOu}
              onChange={(e) => setCustomOu(e.target.value)}
              min="1000"
              step="1000"
              className="h-9 text-sm"
            />
          )}
        </div>

        {/* Fee Summary - Compact */}
        {amount && validateAmount(amount) && (
          <div className="p-2.5 bg-muted rounded text-xs space-y-1">
            <div className="flex justify-between">
              <span>Amount:</span>
              <span className="font-mono">{amountNum.toFixed(4)} OCT</span>
            </div>
            <div className="flex justify-between">
              <span>Fee:</span>
              <span className="font-mono">{fee.toFixed(4)} OCT</span>
            </div>
            <div className="flex justify-between font-medium border-t pt-1 mt-1">
              <span>Total:</span>
              <span className="font-mono">{totalCost.toFixed(4)} OCT</span>
            </div>
          </div>
        )}

        <Button
          onClick={handleSendClick}
          disabled={
            isSending ||
            !addressValidation?.isValid ||
            !validateAmount(amount) ||
            totalCost > currentBalance
          }
          className="w-full h-10 text-sm"
        >
          {isSending ? (
            <div className="flex items-center gap-2">
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white animate-spin" />
              </div>
              <span>Sending...</span>
            </div>
          ) : (
            `Send ${amountNum.toFixed(4)} OCT`
          )}
        </Button>

        {/* Large Transaction Confirmation Dialog */}
        <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">Confirm Large Transaction</AlertDialogTitle>
              <AlertDialogDescription className="text-sm">
                You are about to send {amountNum.toFixed(4)} OCT. Continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-9 text-sm">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={executeSend} className="h-9 text-sm">Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Transaction Modal */}
        <TransactionModal
          open={showTxModal}
          onOpenChange={setShowTxModal}
          status={txModalStatus}
          result={txModalResult}
          type="send"
          isPopupMode={isCompact}
        />
      </div>
    );
  }

  // Full mode (expanded view) - Simplified
  return (
    <div className="space-y-4">
      {/* Animated Icon */}
      <AnimatedIcon type="send-public" size="sm" />

      {/* Recipient Address */}
      <div className="space-y-2">
        <Label htmlFor="recipient">Recipient Address</Label>
        <Input
          id="recipient"
          placeholder="oct..."
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          className="font-mono"
        />
        {recipientAddress.trim() && addressValidation && !addressValidation.isValid && (
          <p className="text-sm text-red-600">{addressValidation.error}</p>
        )}
      </div>

      {/* Amount with Max */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="amount">Amount (OCT)</Label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Balance: <span className="font-mono">{currentBalance.toFixed(6)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                // Calculate fee based on OU selection
                // Fee formula: OU * 0.0000001
                let feeForMax: number;
                
                if (ouOption === 'auto') {
                  // Auto mode: determine OU based on potential max amount
                  // If balance >= 1000 + fee(30000), use 30000 OU
                  // Otherwise use 10000 OU
                  const feeFor30k = 30000 * 0.0000001; // 0.003
                  const feeFor10k = 10000 * 0.0000001; // 0.001
                  
                  if (currentBalance >= 1000 + feeFor30k) {
                    feeForMax = feeFor30k;
                  } else {
                    feeForMax = feeFor10k;
                  }
                } else if (ouOption === 'custom') {
                  const customOuValue = parseInt(customOu) || 10000;
                  feeForMax = customOuValue * 0.0000001;
                } else {
                  feeForMax = parseInt(ouOption) * 0.0000001;
                }
                
                if (currentBalance > feeForMax) {
                  const maxAmount = currentBalance - feeForMax;
                  setAmount(maxAmount.toFixed(8));
                } else {
                  toast({
                    title: "Insufficient Balance",
                    description: `Need more than ${feeForMax.toFixed(7)} OCT to send (for fee)`,
                    variant: "destructive",
                  });
                }
              }}
              className="text-[#0000db] hover:text-[#0000db]/80 font-medium hover:underline"
            >
              Max
            </button>
          </div>
        </div>
        <Input
          id="amount"
          type="number"
          placeholder="0.00000000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.1"
          min="0"
        />
      </div>

      {/* Message Field */}
      <div className="space-y-2">
        <Label htmlFor="message">Message (Optional)</Label>
        <Textarea
          id="message"
          placeholder="Enter an optional message (max 1024 characters)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1024}
          rows={2}
        />
        <div className="text-xs text-muted-foreground text-right">{message.length}/1024</div>
      </div>

      {/* OU (Gas) Settings */}
      <div className="space-y-2">
        <Label>OU (Gas)</Label>
        <Select value={ouOption} onValueChange={setOuOption}>
          <SelectTrigger>
            <SelectValue placeholder="Select OU option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="10000">10,000 OU</SelectItem>
            <SelectItem value="30000">30,000 OU</SelectItem>
            <SelectItem value="50000">50,000 OU</SelectItem>
            <SelectItem value="100000">100,000 OU</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        {ouOption === 'custom' && (
          <Input
            type="number"
            placeholder="Enter custom OU value"
            value={customOu}
            onChange={(e) => setCustomOu(e.target.value)}
            min="1000"
            step="1000"
          />
        )}
      </div>

      {/* Fee Summary */}
      {amount && validateAmount(amount) && (
        <div className="p-3 bg-muted rounded-md text-sm space-y-1">
          <div className="flex justify-between">
            <span>Amount:</span>
            <span className="font-mono">{amountNum.toFixed(8)} OCT</span>
          </div>
          <div className="flex justify-between">
            <span>Fee:</span>
            <span className="font-mono">{fee.toFixed(8)} OCT</span>
          </div>
          <div className="flex justify-between font-medium border-t pt-1 mt-1">
            <span>Total:</span>
            <span className="font-mono">{totalCost.toFixed(8)} OCT</span>
          </div>
        </div>
      )}

      <Button 
        onClick={handleSendClick}
        disabled={
          isSending || 
          !addressValidation?.isValid ||
          !validateAmount(amount) || 
          totalCost > currentBalance ||
          Boolean(message && message.length > 1024)
        }
        className="w-full"
        size="lg"
      >
        {isSending ? "Sending..." : `Send ${amountNum.toFixed(8)} OCT`}
      </Button>

      {/* Large Transaction Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-500">
              <AlertTriangle className="h-5 w-5" />
              Confirm Large Transaction
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>You are about to send a large amount:</p>
              <div className="bg-muted p-3 rounded-md space-y-2 font-mono text-sm">
                <div className="flex justify-between">
                  <span>Amount:</span>
                  <span className="font-bold text-orange-500">{amountNum.toFixed(8)} OCT</span>
                </div>
                <div className="flex justify-between">
                  <span>Fee:</span>
                  <span>{fee.toFixed(8)} OCT</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Total:</span>
                  <span>{totalCost.toFixed(8)} OCT</span>
                </div>
              </div>
              <div className="text-xs break-all">
                <span className="text-muted-foreground">To: </span>
                <span className="font-mono">{recipientAddress}</span>
              </div>
              <p className="text-orange-500 font-medium">
                Please double-check the recipient address. This transaction cannot be reversed!
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={executeSend}
              className="bg-orange-500 hover:bg-orange-600"
            >
              Confirm & Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transaction Modal */}
      <TransactionModal
        open={showTxModal}
        onOpenChange={setShowTxModal}
        status={txModalStatus}
        result={txModalResult}
        type="send"
        onClose={onModalClose}
      />
    </div>
  );
}