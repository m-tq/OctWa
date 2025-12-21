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

// Threshold for confirmation dialog (500 OCT)
const LARGE_TRANSACTION_THRESHOLD = 500;

interface SendTransactionProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  onBalanceUpdate: (balance: number) => void;
  onNonceUpdate: (nonce: number) => void;
  onTransactionSuccess: () => void;
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

export function SendTransaction({ wallet, balance, nonce, onBalanceUpdate, onNonceUpdate, onTransactionSuccess, isCompact = false }: SendTransactionProps) {
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
  const getOuValue = (): number | undefined => {
    if (ouOption === 'auto') return undefined;
    if (ouOption === 'custom') return parseInt(customOu) || undefined;
    return parseInt(ouOption);
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

  const calculateFee = (amount: number) => {
    // Fee calculation based on CLI logic: 0.001 for < 1000, 0.003 for >= 1000
    return amount < 1000 ? 0.001 : 0.003;
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
    const fee = calculateFee(amountNum);
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
  const fee = calculateFee(amountNum);
  const totalCost = amountNum + fee;
  const currentBalance = balance || 0;

  // Compact mode for popup
  if (isCompact) {
    return (
      <div className="space-y-4">
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
                  // Calculate max amount: balance - fee (use higher fee for safety)
                  const maxFee = 0.003; // Use higher fee for safety
                  const maxAmount = Math.max(0, currentBalance - maxFee);
                  if (maxAmount > 0) {
                    setAmount(maxAmount.toFixed(8));
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

        {/* OU (Gas) - Simplified */}
        <div className="space-y-1.5">
          <Label className="text-sm">OU (Gas)</Label>
          <Select value={ouOption} onValueChange={setOuOption}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-sm">Auto</SelectItem>
              <SelectItem value="10000" className="text-sm">10,000</SelectItem>
              <SelectItem value="30000" className="text-sm">30,000</SelectItem>
              <SelectItem value="50000" className="text-sm">50,000</SelectItem>
            </SelectContent>
          </Select>
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
          className="w-full h-9 text-sm"
          size="sm"
        >
          {isSending ? 'Sending...' : `Send ${amountNum.toFixed(4)} OCT`}
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
        />
      </div>
    );
  }

  // Full mode (expanded view)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Send Transaction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <AlertDescription>
              Double-check the recipient address before sending. Transactions cannot be reversed.
            </AlertDescription>
          </div>
        </Alert>

        {/* Wallet Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>From Address</Label>
            <div className="p-3 bg-muted rounded-md font-mono text-sm break-all">
              {wallet.address}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Current Balance</Label>
            <div className="p-3 bg-muted rounded-md font-mono text-sm">
              {currentBalance.toFixed(8)} OCT
            </div>
          </div>
        </div>

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
          
          {/* Address Validation Status */}
          {recipientAddress.trim() && addressValidation && (
            <div className="space-y-2">
              {addressValidation.isValid ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">Valid Octra address</span>
                </div>
              ) : (
                <div className="text-sm text-red-600">{addressValidation.error}</div>
              )}
            </div>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label htmlFor="amount">Amount ( OCT )</Label>
          <Input
            id="amount"
            type="number"
            placeholder="0.00000000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            step="0.1"
            min="0"
          />
          {amount && !validateAmount(amount) && (
            <p className="text-sm text-red-600">Invalid amount</p>
          )}
        </div>

        {/* Message Field */}
        <div className="space-y-2">
          <Label htmlFor="message" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Message ( Optional )
          </Label>
          <Textarea
            id="message"
            placeholder="Enter an optional message (max 1024 characters)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1024}
            rows={3}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>This message will be included in the transaction</span>
            <span>{message.length}/1024</span>
          </div>
        </div>

        {/* OU (Gas) Settings */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            OU (Gas) Settings
          </Label>
          <Select value={ouOption} onValueChange={setOuOption}>
            <SelectTrigger>
              <SelectValue placeholder="Select OU option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (Default: {amountNum < 1000 ? '10,000' : '30,000'})</SelectItem>
              <SelectItem value="10000">10,000 OU</SelectItem>
              <SelectItem value="20000">20,000 OU</SelectItem>
              <SelectItem value="30000">30,000 OU</SelectItem>
              <SelectItem value="50000">50,000 OU</SelectItem>
              <SelectItem value="100000">100,000 OU</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {ouOption === 'custom' && (
            <Input
              type="number"
              placeholder="Enter custom OU value (e.g., 15000)"
              value={customOu}
              onChange={(e) => setCustomOu(e.target.value)}
              min="1000"
              step="1000"
            />
          )}
          <p className="text-xs text-muted-foreground">
            If transaction fails, try increasing the OU value. Higher OU = higher priority.
          </p>
        </div>

        {/* Fee Calculation */}
        {amount && validateAmount(amount) && (
          <div className="p-3 bg-muted rounded-md space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Calculator className="h-4 w-4" />
              Fee Calculation
            </div>
            <div className="space-y-1 text-xs sm:text-sm">
              <div className="flex justify-between items-center">
                <span>Amount:</span>
                <span className="font-mono">{amountNum.toFixed(8)} OCT</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Fee ({amountNum < 1000 ? '< 1000' : '≥ 1000'} OCT):</span>
                <span className="font-mono">{fee.toFixed(8)} OCT</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center font-medium">
                <span>Total Cost:</span>
                <span className="font-mono">{totalCost.toFixed(8)} OCT</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Remaining Balance:</span>
                <span className={`font-mono ${currentBalance - totalCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(currentBalance - totalCost).toFixed(8)} OCT
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Fee structure: 0.001 OCT for amounts &lt; 1000, 0.003 OCT for amounts ≥ 1000
              </div>
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
        />
      </CardContent>
    </Card>
  );
}