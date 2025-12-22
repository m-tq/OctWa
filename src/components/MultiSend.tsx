import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Users, Plus, Trash2, AlertTriangle, Wallet as WalletIcon, CheckCircle, MessageSquare, Loader2, Settings2, XCircle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance, sendTransaction, createTransaction } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface Recipient {
  address: string;
  addressValidation?: { isValid: boolean; error?: string };
  amount: string;
  message: string;
}

interface MultiSendProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  onBalanceUpdate: (balance: number) => void;
  onNonceUpdate: (nonce: number) => void;
  onTransactionSuccess: () => void;
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

export function MultiSend({ wallet, balance, nonce, onBalanceUpdate, onNonceUpdate, onTransactionSuccess }: MultiSendProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([
    { address: '', amount: '', message: '' }
  ]);
  const [isSending, setIsSending] = useState(false);
  const [results, setResults] = useState<Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }>>([]);
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [showTxModal, setShowTxModal] = useState(false);
  const [txProgress, setTxProgress] = useState({ current: 0, total: 0 });
  const [txModalStatus, setTxModalStatus] = useState<'sending' | 'success' | 'error' | 'partial'>('sending');
  const { toast } = useToast();

  // Get OU value based on selection
  const getOuValue = (amount: number): number | undefined => {
    if (ouOption === 'auto') return undefined;
    if (ouOption === 'custom') return parseInt(customOu) || undefined;
    return parseInt(ouOption);
  };

  // Validate address when updating recipient - moved to updateRecipient function
  const validateAndUpdateRecipient = (index: number, field: keyof Recipient, value: string) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-validate address when address field changes
    if (field === 'address') {
      if (!value.trim()) {
        updated[index].addressValidation = undefined;
      } else {
        updated[index].addressValidation = validateRecipientInput(value);
      }
    }
    
    setRecipients(updated);
  };

  const validateAmount = (amountStr: string) => {
    const num = parseFloat(amountStr);
    return !isNaN(num) && num > 0;
  };

  const calculateFee = (amount: number) => {
    // Fee calculation based on CLI logic: 0.001 for < 1000, 0.003 for >= 1000
    return amount < 1000 ? 0.001 : 0.003;
  };

  const addRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '', message: '' }]);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    validateAndUpdateRecipient(index, field, value);
  };

  const validateAllRecipients = () => {
    for (const recipient of recipients) {
      if (!recipient.address.trim()) {
        return { valid: false, error: 'All recipient addresses are required' };
      }
      
      const validation = validateRecipientInput(recipient.address);
      if (!validation.isValid) {
        return { valid: false, error: `Invalid address: ${validation.error}` };
      }

      if (!validateAmount(recipient.amount)) {
        return { valid: false, error: 'All amounts must be valid positive numbers' };
      }

      if (recipient.message && recipient.message.length > 1024) {
        return { valid: false, error: 'Message too long (max 1024 characters)' };
      }
    }
    return { valid: true };
  };

  const calculateTotalCost = () => {
    return recipients.reduce((total, recipient) => {
      const amount = parseFloat(recipient.amount) || 0;
      const fee = calculateFee(amount);
      return total + amount + fee;
    }, 0);
  };

  const handleSendAll = async () => {
    if (!wallet) {
      toast({
        title: "Error",
        description: "No wallet connected",
        variant: "destructive",
      });
      return;
    }

    const validation = validateAllRecipients();
    if (!validation.valid) {
      toast({
        title: "Error",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }

    const totalCost = calculateTotalCost();
    if (balance !== null && totalCost > balance) {
      toast({
        title: "Error",
        description: `Insufficient balance. Need ${totalCost.toFixed(8)} OCT total`,
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    setResults([]);
    setShowTxModal(true);
    setTxModalStatus('sending');
    setTxProgress({ current: 0, total: recipients.length });

    try {
      // Refresh nonce before sending
      const freshBalanceData = await fetchBalance(wallet.address);
      let currentNonce = freshBalanceData.nonce;

      const sendResults: Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }> = [];

      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const amount = parseFloat(recipient.amount);
        setTxProgress({ current: i + 1, total: recipients.length });
        
        try {
          const transaction = createTransaction(
            wallet.address,
            recipient.address.trim(),
            amount,
            currentNonce + 1,
            wallet.privateKey,
            wallet.publicKey || '',
            recipient.message || undefined,
            getOuValue(amount)
          );

          const sendResult = await sendTransaction(transaction);
          
          sendResults.push({
            ...sendResult,
            recipient: recipient.address,
            amount: recipient.amount
          });

          if (sendResult.success) {
            currentNonce++;
          }
        } catch (error) {
          sendResults.push({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            recipient: recipient.address,
            amount: recipient.amount
          });
        }
      }

      setResults(sendResults);

      const successCount = sendResults.filter(r => r.success).length;
      const failCount = sendResults.length - successCount;

      if (successCount > 0) {
        if (failCount === 0) {
          setTxModalStatus('success');
        } else {
          setTxModalStatus('partial');
        }

        // Update nonce and balance
        onNonceUpdate(currentNonce);

        setTimeout(async () => {
          try {
            const updatedBalance = await fetchBalance(wallet.address);
            onBalanceUpdate(updatedBalance.balance);
            onNonceUpdate(updatedBalance.nonce);
          } catch (error) {
            console.error('Failed to refresh balance after transactions:', error);
          }
        }, 2000);

        if (failCount === 0) {
          // Reset form if all transactions succeeded
          setRecipients([{ address: '', amount: '', message: '' }]);
          onTransactionSuccess();
        }
      } else {
        setTxModalStatus('error');
      }
    } catch (error) {
      console.error('Multi-send error:', error);
      setTxModalStatus('error');
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

  const totalCost = calculateTotalCost();
  const currentBalance = balance || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Multi Send
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <AlertDescription>
              Send to multiple recipients in separate transactions. Each transaction requires a separate fee.
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

        {/* Recipients */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Recipients ({recipients.length})</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRecipient}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Recipient
            </Button>
          </div>

          {recipients.map((recipient, index) => (
            <Card key={index} className="p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Recipient {index + 1}</span>
                  {recipients.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRecipient(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Address */}
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                      placeholder="oct..."
                      value={recipient.address}
                      onChange={(e) => updateRecipient(index, 'address', e.target.value)}
                      className="font-mono"
                    />
                    
                    {/* Address Validation Status */}
                    {recipient.address.trim() && recipient.addressValidation && (
                      <div className="space-y-1">
                        {recipient.addressValidation.isValid ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span className="text-sm text-green-600">Valid Octra address</span>
                          </div>
                        ) : (
                          <div className="text-sm text-red-600">{recipient.addressValidation.error}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="space-y-2">
                    <Label>Amount (OCT)</Label>
                    <Input
                      type="number"
                      placeholder="0.00000000"
                      value={recipient.amount}
                      onChange={(e) => updateRecipient(index, 'amount', e.target.value)}
                      step="0.1"
                      min="0"
                    />
                    {recipient.amount && !validateAmount(recipient.amount) && (
                      <p className="text-sm text-red-600">Invalid amount</p>
                    )}
                  </div>
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Message (Optional)
                  </Label>
                  <Textarea
                    placeholder="Enter an optional message (max 1024 characters)"
                    value={recipient.message}
                    onChange={(e) => updateRecipient(index, 'message', e.target.value)}
                    maxLength={1024}
                    rows={2}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>This message will be included in the transaction</span>
                    <span>{recipient.message.length}/1024</span>
                  </div>
                </div>

                {/* Fee calculation for this recipient */}
                {recipient.amount && validateAmount(recipient.amount) && (
                  <div className="p-2 bg-muted/50 rounded text-xs">
                    <div className="flex justify-between">
                      <span>Amount:</span>
                      <span className="font-mono">{parseFloat(recipient.amount).toFixed(8)} OCT</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fee:</span>
                      <span className="font-mono">{calculateFee(parseFloat(recipient.amount)).toFixed(8)} OCT</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Total:</span>
                      <span className="font-mono">{(parseFloat(recipient.amount) + calculateFee(parseFloat(recipient.amount))).toFixed(8)} OCT</span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Total Summary */}
        {recipients.some(r => r.amount && validateAmount(r.amount)) && (
          <div className="p-4 bg-muted rounded-md space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              Total Summary
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Total Recipients:</span>
                <span>{recipients.filter(r => r.amount && validateAmount(r.amount)).length}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Amount:</span>
                <span className="font-mono">
                  {recipients.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(8)} OCT
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total Fees:</span>
                <span className="font-mono">
                  {recipients.reduce((sum, r) => {
                    const amount = parseFloat(r.amount) || 0;
                    return sum + (amount > 0 ? calculateFee(amount) : 0);
                  }, 0).toFixed(8)} OCT
                </span>
              </div>
              <Separator />
              <div className="flex justify-between font-medium">
                <span>Total Cost:</span>
                <span className="font-mono">{totalCost.toFixed(8)} OCT</span>
              </div>
              <div className="flex justify-between">
                <span>Remaining Balance:</span>
                <span className={`font-mono ${currentBalance - totalCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(currentBalance - totalCost).toFixed(8)} OCT
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Transaction Results removed - now shown in modal */}

        {/* Transaction Modal */}
        <Dialog open={showTxModal} onOpenChange={txModalStatus === 'sending' ? undefined : setShowTxModal}>
          <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => txModalStatus === 'sending' && e.preventDefault()}>
            <VisuallyHidden>
              <DialogTitle>Multi Send Transaction</DialogTitle>
              <DialogDescription>Transaction status for multi-send operation</DialogDescription>
            </VisuallyHidden>
            <div className="flex flex-col items-center justify-center py-6 space-y-4">
              {/* Sending State */}
              {txModalStatus === 'sending' && (
                <>
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 rounded-full border-4 border-[#0000db]/20" />
                    <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#0000db] animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-[#0000db] animate-spin" />
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold">Multi Send</h3>
                    <p className="text-sm text-muted-foreground">
                      Sending transaction {txProgress.current} of {txProgress.total}...
                    </p>
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
              {txModalStatus === 'success' && (
                <>
                  <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                    <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold text-green-600 dark:text-green-400">All Sent!</h3>
                    <p className="text-sm text-muted-foreground">
                      {results.length} transaction(s) sent successfully
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {results.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(8)} OCT Total
                  </Badge>
                  <Button onClick={() => { setShowTxModal(false); setResults([]); }} className="mt-4 bg-[#0000db] hover:bg-[#0000db]/90">
                    Close
                  </Button>
                </>
              )}

              {/* Partial Success State */}
              {txModalStatus === 'partial' && (
                <>
                  <div className="w-20 h-20 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                    <AlertTriangle className="w-12 h-12 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">Partial Success</h3>
                    <p className="text-sm text-muted-foreground">
                      {results.filter(r => r.success).length} sent, {results.filter(r => !r.success).length} failed
                    </p>
                  </div>
                  <div className="w-full max-h-40 overflow-y-auto space-y-2">
                    {results.map((result, idx) => (
                      <div key={idx} className={`flex items-center gap-2 p-2 rounded text-xs ${result.success ? 'bg-green-50 dark:bg-green-950/50' : 'bg-red-50 dark:bg-red-950/50'}`}>
                        {result.success ? <CheckCircle className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                        <span className="font-mono truncate flex-1">{result.recipient.slice(0, 8)}...{result.recipient.slice(-6)}</span>
                        <span>{result.amount} OCT</span>
                      </div>
                    ))}
                  </div>
                  <Button onClick={() => { setShowTxModal(false); setResults([]); }} variant="outline" className="mt-4">
                    Close
                  </Button>
                </>
              )}

              {/* Error State */}
              {txModalStatus === 'error' && (
                <>
                  <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                    <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">All Failed</h3>
                    <p className="text-sm text-muted-foreground">No transactions were sent successfully</p>
                  </div>
                  <Button onClick={() => { setShowTxModal(false); setResults([]); }} variant="outline" className="mt-4">
                    Close
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

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
              <SelectItem value="auto">Auto (Default based on amount)</SelectItem>
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
            If transactions fail, try increasing the OU value.
          </p>
        </div>

        <Button
          onClick={handleSendAll}
          disabled={
            isSending ||
            recipients.length === 0 ||
            !validateAllRecipients().valid ||
            totalCost > currentBalance
          }
          className="w-full"
          size="lg"
        >
          {isSending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending {recipients.length} Transaction(s)...
            </>
          ) : (
            `Send to ${recipients.length} Recipient(s) - ${totalCost.toFixed(8)} OCT Total`
          )}
        </Button>
      </CardContent>
    </Card>
  );
}