import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Upload, FileText, AlertTriangle, Wallet as WalletIcon, CheckCircle, Zap, Trash2, Settings2, Loader2, XCircle } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance, sendTransaction, createTransaction } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface FileRecipient {
  address: string;
  amount: string;
  isValid: boolean;
  error?: string;
}

interface FileMultiSendProps {
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

export function FileMultiSend({ wallet, balance, onBalanceUpdate, onNonceUpdate, onTransactionSuccess }: FileMultiSendProps) {
  const [recipients, setRecipients] = useState<FileRecipient[]>([]);
  const [amountMode, setAmountMode] = useState<'same' | 'different'>('same');
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [showTxModal, setShowTxModal] = useState(false);
  const [txProgress, setTxProgress] = useState({ current: 0, total: 0 });
  const [txModalStatus, setTxModalStatus] = useState<'sending' | 'success' | 'error' | 'partial'>('sending');

  // Get OU value based on selection
  const getOuValue = (amount: number): number | undefined => {
    if (ouOption === 'auto') return undefined;
    if (ouOption === 'custom') return parseInt(customOu) || undefined;
    return parseInt(ouOption);
  };
  const [sameAmount, setSameAmount] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [results, setResults] = useState<Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }>>([]);
  const { toast } = useToast();

  const calculateFee = (amount: number) => {
    return amount < 1000 ? 0.001 : 0.003;
  };

  const validateAmount = (amountStr: string) => {
    const num = parseFloat(amountStr);
    return !isNaN(num) && num > 0;
  };

  const processFileContent = async (content: string) => {
    setIsProcessing(true);
    
    try {
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      if (lines.length === 0) {
        toast({
          title: "Error",
          description: "File is empty or contains no valid lines",
          variant: "destructive",
        });
        // Reset file input
        const fileInput = document.getElementById('fileInput') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        return;
      }
      
      const processedRecipients: FileRecipient[] = [];
      
      for (const line of lines) {
        let address = '';
        let amount = '';
        let error = '';

        if (amountMode === 'same') {
          // Each line is just an address
          address = line;
          amount = sameAmount;
        } else {
          // Each line is "address,amount" or "address amount"
          const parts = line.split(/[,\s]+/);
          if (parts.length >= 2) {
            address = parts[0];
            amount = parts[1];
          } else {
            error = 'Invalid format. Expected "address,amount" or "address amount"';
          }
        }

        if (!error) {
          const validation = validateRecipientInput(address);
          if (!validation.isValid) {
            error = validation.error || 'Invalid address';
          } else if (!validateAmount(amount)) {
            error = 'Invalid amount';
          }
        }

        processedRecipients.push({
          address: address.trim(),
          amount: amount,
          isValid: !error,
          error: error || undefined
        });
      }

      setRecipients(processedRecipients);

      const validCount = processedRecipients.filter(r => r.isValid).length;
      const invalidCount = processedRecipients.length - validCount;

      toast({
        title: "File Processed",
        description: `${validCount} valid recipients${invalidCount > 0 ? `, ${invalidCount} invalid` : ''}`,
      });

    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process file",
        variant: "destructive",
      });
      // Reset file input on processing error
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = useCallback((file: File) => {
    if (!file) return;

    if (!file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
      toast({
        title: "Error",
        description: "Please upload a .txt or .csv file",
        variant: "destructive",
      });
      // Reset file input
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      return;
    }

    if (amountMode === 'same' && !validateAmount(sameAmount)) {
      toast({
        title: "Error",
        description: "Please enter a valid amount for all recipients",
        variant: "destructive",
      });
      // Reset file input
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      processFileContent(content);
    };
    reader.onerror = () => {
      toast({
        title: "Error",
        description: "Failed to read file",
        variant: "destructive",
      });
      // Reset file input on read error
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    };
    reader.readAsText(file);
  }, [amountMode, sameAmount]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const removeRecipient = (index: number) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const updateRecipientAmount = (index: number, amount: string) => {
    const updated = [...recipients];
    updated[index] = { 
      ...updated[index], 
      amount,
      isValid: validateRecipientInput(updated[index].address).isValid && validateAmount(amount),
      error: !validateAmount(amount) ? 'Invalid amount' : undefined
    };
    setRecipients(updated);
  };

  const calculateTotalCost = () => {
    return recipients
      .filter(r => r.isValid)
      .reduce((total, recipient) => {
        const amount = parseFloat(recipient.amount) || 0;
        const fee = calculateFee(amount);
        return total + amount + fee;
      }, 0);
  };

  const clearAllRecipients = () => {
    setRecipients([]);
    setResults([]);
    // Reset file input
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
    
    toast({
      title: "Cleared",
      description: "All recipients have been cleared",
    });
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

    const validRecipients = recipients.filter(r => r.isValid);
    if (validRecipients.length === 0) {
      toast({
        title: "Error",
        description: "No valid recipients found",
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
    setTxProgress({ current: 0, total: validRecipients.length });

    try {
      // Refresh nonce before sending
      const freshBalanceData = await fetchBalance(wallet.address);
      let currentNonce = freshBalanceData.nonce;

      const sendResults: Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }> = [];

      for (let i = 0; i < validRecipients.length; i++) {
        const recipient = validRecipients[i];
        const amount = parseFloat(recipient.amount);
        setTxProgress({ current: i + 1, total: validRecipients.length });
        
        try {
          const transaction = createTransaction(
            wallet.address,
            recipient.address.trim(),
            amount,
            currentNonce + 1,
            wallet.privateKey,
            wallet.publicKey || '',
            undefined, // No message support in file multi-send
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
          setRecipients([]);
          onTransactionSuccess();
        }
      } else {
        setTxModalStatus('error');
      }
    } catch (error) {
      console.error('File multi-send error:', error);
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

  const validRecipients = recipients.filter(r => r.isValid);
  const invalidRecipients = recipients.filter(r => !r.isValid);
  const totalCost = calculateTotalCost();
  const currentBalance = balance || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          File Multi Send
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <AlertDescription>
              Upload a file with recipient addresses to send transactions in bulk. Each transaction requires a separate fee.
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

        {/* Amount Mode Selection */}
        <div className="space-y-4">
          <Label className="text-base font-medium">Amount Configuration</Label>
          <RadioGroup value={amountMode} onValueChange={(value: 'same' | 'different') => setAmountMode(value)}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="same" id="same" />
              <Label htmlFor="same">Same amount for all recipients</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="different" id="different" />
              <Label htmlFor="different">Different amounts (specified in file)</Label>
            </div>
          </RadioGroup>

          {amountMode === 'same' && (
            <div className="space-y-2">
              <Label htmlFor="sameAmount">Amount for all recipients (OCT)</Label>
              <Input
                id="sameAmount"
                type="number"
                placeholder="0.00000000"
                value={sameAmount}
                onChange={(e) => setSameAmount(e.target.value)}
                step="0.1"
                min="0"
              />
              {sameAmount && !validateAmount(sameAmount) && (
                <p className="text-sm text-red-600">Invalid amount</p>
              )}
            </div>
          )}
        </div>

        {/* File Upload */}
        <div className="space-y-4">
          <Label className="text-base font-medium">Upload Recipients File</Label>
          
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver 
                ? 'border-primary bg-primary/5' 
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <div className="space-y-2">
              <p className="text-lg font-medium">
                {isDragOver ? 'Drop your file here' : 'Drag and drop your file here'}
              </p>
              <p className="text-sm text-muted-foreground">
                or click to browse for a .txt or .csv file
              </p>
              <Input
                type="file"
                accept=".txt,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className="hidden"
                id="fileInput"
              />
              <Button
                variant="outline"
                onClick={() => document.getElementById('fileInput')?.click()}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Browse Files'}
              </Button>
            </div>
          </div>

          {/* File Format Instructions */}
          <div className="p-4 bg-muted/50 rounded-md space-y-2">
            <h4 className="font-medium text-sm">File Format Instructions:</h4>
            <div className="text-xs text-muted-foreground space-y-1">
              {amountMode === 'same' ? (
                <>
                  <div>• One address per line</div>
                  <div>• Example: oct1234567890abcdef...</div>
                </>
              ) : (
                <>
                  <div>• Format: address,amount or address amount</div>
                  <div>• Example: oct1234567890abcdef...,10.5</div>
                  <div>• Example: oct1234567890abcdef... 10.5</div>
                </>
              )}
              <div>• Supports Octra addresses</div>
              <div>• Empty lines are ignored</div>
            </div>
          </div>
        </div>

        {/* Recipients Preview */}
        {recipients.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">
                Recipients Preview ({recipients.length} total)
              </Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAllRecipients}
                  className="text-red-600 hover:text-red-800 border-red-200 hover:border-red-300"
                >
                  Clear All
                </Button>
                <Badge variant="outline" className="text-green-600">
                  {validRecipients.length} valid
                </Badge>
                {invalidRecipients.length > 0 && (
                  <Badge variant="outline" className="text-red-600">
                    {invalidRecipients.length} invalid
                  </Badge>
                )}
              </div>
            </div>

            <ScrollArea className="h-64 border rounded-md p-4">
              <div className="space-y-2">
                {recipients.map((recipient, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-2 rounded text-sm ${
                      recipient.isValid 
                        ? 'bg-green-50 dark:bg-green-950/50' 
                        : 'bg-red-50 dark:bg-red-950/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {recipient.isValid ? (
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                        )}
                        <span className="font-mono text-xs break-all">
                          {recipient.address}
                        </span>
                      </div>
                      {recipient.error && (
                        <p className="text-xs text-red-600 mt-1 ml-6">{recipient.error}</p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      {amountMode === 'different' && recipient.isValid && (
                        <Input
                          type="number"
                          value={recipient.amount}
                          onChange={(e) => updateRecipientAmount(index, e.target.value)}
                          className="w-24 h-8 text-xs"
                          step="0.1"
                          min="0"
                        />
                      )}
                      {amountMode === 'same' && (
                        <span className="text-xs font-mono">{recipient.amount} OCT</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRecipient(index)}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Total Summary */}
        {validRecipients.length > 0 && (
          <div className="p-4 bg-muted rounded-md space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Zap className="h-4 w-4" />
              Transaction Summary
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Valid Recipients:</span>
                <span>{validRecipients.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Amount:</span>
                <span className="font-mono">
                  {validRecipients.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(8)} OCT
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total Fees:</span>
                <span className="font-mono">
                  {validRecipients.reduce((sum, r) => {
                    const amount = parseFloat(r.amount) || 0;
                    return sum + calculateFee(amount);
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
              <DialogTitle>File Multi Send Transaction</DialogTitle>
              <DialogDescription>Transaction status for file multi-send operation</DialogDescription>
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
                    <h3 className="text-lg font-semibold">File Multi Send</h3>
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
            validRecipients.length === 0 ||
            totalCost > currentBalance ||
            (amountMode === 'same' && !validateAmount(sameAmount))
          }
          className="w-full"
          size="lg"
        >
          {isSending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending {validRecipients.length} Transaction(s)...
            </>
          ) : (
            `Send to ${validRecipients.length} Recipient(s) - ${totalCost.toFixed(8)} OCT Total`
          )}
        </Button>
      </CardContent>
    </Card>
  );
}