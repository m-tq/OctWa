import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Users, Plus, Trash2, AlertTriangle, Wallet as WalletIcon, CheckCircle, ExternalLink, Copy, MessageSquare, Loader2 } from 'lucide-react';
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
  const { toast } = useToast();

  // Validate addresses when recipient addresses change
  useEffect(() => {
    const updatedRecipients = recipients.map((recipient) => {
      if (!recipient.address.trim()) {
        return {
          ...recipient,
          addressValidation: undefined
        };
      }

      const validation = validateRecipientInput(recipient.address);
      return {
        ...recipient,
        addressValidation: validation
      };
    });

    setRecipients(updatedRecipients);
  }, [recipients.map(r => r.address).join(',')]);

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

  const addRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '', message: '' }]);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipients(updated);
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

    try {
      // Refresh nonce before sending
      const freshBalanceData = await fetchBalance(wallet.address);
      let currentNonce = freshBalanceData.nonce;

      const sendResults: Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }> = [];

      for (const recipient of recipients) {
        const amount = parseFloat(recipient.amount);
        
        try {
          const transaction = createTransaction(
            wallet.address,
            recipient.address.trim(),
            amount,
            currentNonce + 1,
            wallet.privateKey,
            wallet.publicKey || '',
            recipient.message || undefined
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
        toast({
          title: "Transactions Sent!",
          description: `${successCount} transaction(s) sent successfully${failCount > 0 ? `, ${failCount} failed` : ''}`,
        });

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
        toast({
          title: "All Transactions Failed",
          description: "No transactions were sent successfully",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Multi-send error:', error);
      toast({
        title: "Error",
        description: "Failed to send transactions",
        variant: "destructive",
      });
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

        {/* Transaction Results */}
        {results.length > 0 && (
          <div className="space-y-3">
            <Label className="text-base font-medium">Transaction Results</Label>
            {results.map((result, index) => (
              <div
                key={index}
                className={`rounded-lg p-3 ${result.success ? 'bg-green-50 border border-green-200 dark:bg-green-950/50 dark:border-green-800' : 'bg-red-50 border border-red-200 dark:bg-red-950/50 dark:border-red-800'}`}
              >
                <div className="flex items-start space-x-2">
                  {result.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <p className={`text-sm font-medium ${result.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                        {result.success ? 'Success' : 'Failed'} - {result.amount} OCT
                      </p>
                      <code className="text-xs font-mono break-all text-muted-foreground">
                        {result.recipient.slice(0, 10)}...{result.recipient.slice(-8)}
                      </code>
                    </div>
                    {result.success && result.hash && (
                      <div className="mt-1">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1">
                          <code className="text-xs bg-green-100 dark:bg-green-900/50 px-2 py-1 rounded font-mono break-all text-green-800 dark:text-green-200 flex-1">
                            {result.hash}
                          </code>
                          <div className="flex space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(result.hash!, 'Transaction Hash')}
                              className="h-6 w-6 p-0"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <a
                              href={`https://octrascan.io/tx/${result.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-6 w-6 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                              title="View on OctraScan"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                    {result.error && (
                      <p className="text-red-700 dark:text-red-300 text-xs mt-1 break-words">{result.error}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

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