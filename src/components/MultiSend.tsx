import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { ScrollArea, ScrollAreaContent } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Trash2, AlertTriangle, Wallet as WalletIcon, CheckCircle, MessageSquare, Loader2, Settings2, XCircle, ChevronDown, Clock } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance, sendTransaction, createTransaction, invalidateCacheAfterTransaction } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { AnimatedIcon } from './AnimatedIcon';
import { AddressInput } from './AddressInput';

interface Recipient {
  address: string;
  addressValidation?: { isValid: boolean; error?: string };
  amount: string;
  message: string;
  showMessage?: boolean;
}

interface MultiSendProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  onBalanceUpdate: (balance: number) => void;
  onNonceUpdate: (nonce: number) => void;
  onTransactionSuccess: () => void;
  onModalClose?: () => void;
  hideBorder?: boolean;
  resetTrigger?: number;
  sidebarOpen?: boolean;
  historySidebarOpen?: boolean;
  onAddToAddressBook?: (address: string) => void; // Callback to add address to address book
}

// Simple address validation function
function isOctraAddress(input: string): boolean {
  const addressRegex = /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/;
  return addressRegex.test(input);
}

// Truncate address for display
function truncateAddress(address: string): string {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function validateRecipientInput(input: string): { isValid: boolean; error?: string } {
  if (!input || input.trim().length === 0) {
    return { isValid: false, error: 'Address is required' };
  }
  const trimmedInput = input.trim();
  if (isOctraAddress(trimmedInput)) {
    return { isValid: true };
  }
  return { 
    isValid: false, 
    error: 'Invalid address format'
  };
}

export function MultiSend({ wallet, balance, onBalanceUpdate, onNonceUpdate, onTransactionSuccess, resetTrigger, sidebarOpen = true, historySidebarOpen = true, onAddToAddressBook }: MultiSendProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([
    { address: '', amount: '', message: '', showMessage: false }
  ]);
  const [isSending, setIsSending] = useState(false);
  const [results, setResults] = useState<Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }>>([]);
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [showOuSettings, setShowOuSettings] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txProgress, setTxProgress] = useState({ current: 0, total: 0, currentRecipient: '', currentAmount: '' });
  const [txModalStatus, setTxModalStatus] = useState<'sending' | 'success' | 'error' | 'partial'>('sending');
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const { toast } = useToast();

  // Reset all state when resetTrigger changes
  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      setRecipients([{ address: '', amount: '', message: '', showMessage: false }]);
      setResults([]);
      setOuOption('auto');
      setCustomOu('');
      setShowOuSettings(false);
      setElapsedTime(0);
    }
  }, [resetTrigger]);

  // Get OU value for a specific amount
  const getOuValue = (amount: number): number => {
    if (ouOption === 'auto') {
      // Auto: 10000 for < 1000 OCT, 30000 for >= 1000 OCT
      return amount < 1000 ? 10000 : 30000;
    }
    if (ouOption === 'custom') return parseInt(customOu) || 10000;
    return parseInt(ouOption) || 10000;
  };

  // Calculate fee based on OU: OU * 0.0000001 (1 OU = 0.0000001 OCT)
  // Example: 10000 OU = 0.001 OCT, 30000 OU = 0.003 OCT
  const calculateFee = (amount: number): number => {
    const ou = getOuValue(amount);
    return ou * 0.0000001;
  };

  const validateAndUpdateRecipient = (index: number, field: keyof Recipient, value: string | boolean) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'address' && typeof value === 'string') {
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

  const addRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '', message: '', showMessage: false }]);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
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

  const calculateTotalAmount = () => {
    return recipients.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  };

  const handleSendAll = async () => {
    if (!wallet) {
      toast({ title: "Error", description: "No wallet connected", variant: "destructive" });
      return;
    }

    const validation = validateAllRecipients();
    if (!validation.valid) {
      toast({ title: "Error", description: validation.error, variant: "destructive" });
      return;
    }

    const totalCost = calculateTotalCost();
    if (balance !== null && totalCost > balance) {
      toast({ title: "Error", description: `Insufficient balance. Need ${totalCost.toFixed(8)} OCT total`, variant: "destructive" });
      return;
    }

    setIsSending(true);
    setResults([]);
    setShowTxModal(true);
    setTxModalStatus('sending');
    setTxProgress({ current: 0, total: recipients.length, currentRecipient: '', currentAmount: '' });
    setElapsedTime(0);

    let startTime = 0; // Will be set when first transaction is submitted
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 5000; // 5 seconds delay between retries

    try {
      const freshBalanceData = await fetchBalance(wallet.address);
      let currentNonce = freshBalanceData.nonce;
      const sendResults: Array<{ success: boolean; hash?: string; error?: string; recipient: string; amount: string }> = [];

      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const amount = parseFloat(recipient.amount);
        setTxProgress({ 
          current: i + 1, 
          total: recipients.length,
          currentRecipient: recipient.address,
          currentAmount: recipient.amount
        });
        
        let txSuccess = false;
        let lastError = '';
        let txHash = '';

        // Try up to MAX_RETRIES times
        for (let retry = 0; retry <= MAX_RETRIES && !txSuccess; retry++) {
          try {
            // Re-fetch nonce on retry to get the latest state
            if (retry > 0) {
              // Update progress to show retrying
              setTxProgress(prev => ({ 
                ...prev, 
                currentRecipient: `${recipient.address} (Retry ${retry}/${MAX_RETRIES})`
              }));
              
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              
              // Fetch fresh nonce for retry
              const retryBalanceData = await fetchBalance(wallet.address);
              currentNonce = retryBalanceData.nonce;
            }

            // Start timer when first transaction is about to be submitted
            if (i === 0 && retry === 0) {
              startTime = Date.now();
            }

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
            
            if (sendResult.success) {
              txSuccess = true;
              txHash = sendResult.hash || '';
              currentNonce++; // Only increment on success
            } else {
              lastError = sendResult.error || 'Transaction failed';
              // Check if it's a nonce error - if so, retry
              if (lastError.toLowerCase().includes('nonce') && retry < MAX_RETRIES) {
                continue; // Will retry
              }
              // For non-nonce errors or last retry, break
              if (retry === MAX_RETRIES) break;
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            // Check if it's a nonce error
            if (lastError.toLowerCase().includes('nonce') && retry < MAX_RETRIES) {
              continue; // Will retry
            }
            if (retry === MAX_RETRIES) break;
          }
        }

        // Add final result
        const resultEntry = {
          success: txSuccess,
          hash: txHash || undefined,
          error: txSuccess ? undefined : lastError,
          recipient: recipient.address,
          amount: recipient.amount
        };
        sendResults.push(resultEntry);
        setResults([...sendResults]); // Update results in real-time
      }

      // Calculate elapsed time
      const endTime = Date.now();
      const totalElapsed = (endTime - startTime) / 1000; // in seconds
      setElapsedTime(totalElapsed);

      const successCount = sendResults.filter(r => r.success).length;
      const failCount = sendResults.length - successCount;

      if (successCount > 0) {
        setTxModalStatus(failCount === 0 ? 'success' : 'partial');
        onNonceUpdate(currentNonce);

        setTimeout(async () => {
          try {
            // Invalidate cache first
            await invalidateCacheAfterTransaction(wallet.address);
            const updatedBalance = await fetchBalance(wallet.address, true);
            onBalanceUpdate(updatedBalance.balance);
            onNonceUpdate(updatedBalance.nonce);
          } catch (error) {
            console.error('Failed to refresh balance:', error);
          }
        }, 2000);

        if (failCount === 0) {
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

  const handleModalClose = () => {
    setShowTxModal(false);
    // Reset form only on success
    if (txModalStatus === 'success') {
      setRecipients([{ address: '', amount: '', message: '', showMessage: false }]);
    }
    setResults([]);
  };

  if (!wallet) {
    return (
      <Alert>
        <div className="flex items-start space-x-3">
          <WalletIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <AlertDescription>No wallet available. Please generate or import a wallet first.</AlertDescription>
        </div>
      </Alert>
    );
  }

  const totalCost = calculateTotalCost();
  const totalAmount = calculateTotalAmount();
  const currentBalance = balance || 0;
  const validRecipientCount = recipients.filter(r => r.address.trim() && r.addressValidation?.isValid && validateAmount(r.amount)).length;

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 lg:gap-6 overflow-auto lg:overflow-hidden">
      {/* Left Panel - Wallet Info & Controls */}
      <div className="w-full lg:w-80 flex-shrink-0 space-y-4 lg:flex lg:flex-col lg:justify-center overflow-visible">
          {/* Animated Icon - Hidden on mobile */}
          <div className="hidden lg:block">
            <AnimatedIcon type="multi-send" size="sm" />
          </div>

          {/* Active Address + Balance Combined */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Active Address</Label>
            <div className="p-2.5 bg-muted font-mono text-xs">
              {truncateAddress(wallet.address)} | {currentBalance.toFixed(4)} OCT
            </div>
          </div>

          {/* Recipients Count */}
          <div className="flex items-center justify-between p-2.5 border">
            <span className="text-sm">Recipients</span>
            <Badge variant="secondary">{recipients.length}</Badge>
          </div>

          {/* Add Recipient Button */}
          <Button
            type="button"
            variant="outline"
            onClick={addRecipient}
            className="w-full flex items-center justify-center gap-2 text-[#0000db] border-[#0000db] hover:bg-[#0000db]/10"
          >
          <Plus className="h-4 w-4" />
          Add Recipient
        </Button>

        {/* OU Settings Collapsible */}
        <Collapsible open={showOuSettings} onOpenChange={setShowOuSettings}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                OU (Gas) Settings
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showOuSettings ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            <Select value={ouOption} onValueChange={setOuOption}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Auto" />
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
                placeholder="Custom OU value"
                value={customOu}
                onChange={(e) => setCustomOu(e.target.value)}
                min="1000"
                step="1000"
                className="text-sm"
              />
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Fee & Total Summary */}
        {validRecipientCount > 0 && (
          <div className="p-3 bg-muted/50  space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-mono">{totalAmount.toFixed(8)} OCT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee ({validRecipientCount}x)</span>
              <span className="font-mono">{(totalCost - totalAmount).toFixed(8)} OCT</span>
            </div>
            <div className="h-px bg-border my-1.5" />
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="font-mono">{totalCost.toFixed(8)} OCT</span>
            </div>
          </div>
        )}

        {/* Send Button */}
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
              Sending...
            </>
          ) : (
            <span className="text-sm">
              Send to {validRecipientCount} recipient{validRecipientCount !== 1 ? 's' : ''} - {totalAmount.toFixed(4)} OCT
            </span>
          )}
        </Button>

        {/* Insufficient balance warning */}
        {totalCost > currentBalance && (
          <p className="text-xs text-red-500 text-center">
            Insufficient balance (need {totalCost.toFixed(4)} OCT)
          </p>
        )}
      </div>

      {/* Separator - Hidden on mobile */}
      <div className="hidden lg:block w-px bg-border flex-shrink-0" />

      {/* Right Panel - Recipients Grid with ScrollArea */}
      <div className="flex-1 lg:flex lg:flex-col lg:min-h-0">
        <ScrollArea className="h-[400px] lg:flex-1" stabilizeGutter>
          <ScrollAreaContent className={`grid grid-cols-1 gap-4 ${
            sidebarOpen && historySidebarOpen 
              ? '' 
              : sidebarOpen || historySidebarOpen 
                ? 'sm:grid-cols-2' 
                : 'sm:grid-cols-2 xl:grid-cols-3'
          }`}>
            {recipients.map((recipient, index) => (
              <Card key={index} className="p-3 space-y-3">
                {/* Header with number and delete */}
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">#{index + 1}</Badge>
                  {recipients.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRecipient(index)}
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {/* Address */}
                <div className="space-y-1">
                  <Label className="text-xs">Address</Label>
                  <AddressInput
                    value={recipient.address}
                    onChange={(value) => validateAndUpdateRecipient(index, 'address', value)}
                    isPopupMode={true}
                    isCompact={true}
                    activeWalletAddress={wallet?.address}
                    onAddToAddressBook={onAddToAddressBook}
                    currentMode="public"
                    className={`text-xs ${
                      recipient.address.trim() && recipient.addressValidation
                        ? recipient.addressValidation.isValid
                          ? 'border-[#0000db] focus-visible:ring-[#0000db]'
                          : 'border-red-500 focus-visible:ring-red-500'
                        : ''
                    }`}
                  />
                </div>

                {/* Amount */}
                <div className="space-y-1">
                  <Label className="text-xs">Amount (OCT)</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={recipient.amount}
                    onChange={(e) => validateAndUpdateRecipient(index, 'amount', e.target.value)}
                    step="0.1"
                    min="0"
                    className="text-xs h-8"
                  />
                </div>

                {/* Add Message Toggle */}
                {!recipient.showMessage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => validateAndUpdateRecipient(index, 'showMessage', true)}
                    className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <MessageSquare className="h-3 w-3 mr-1" />
                    Add Message
                  </Button>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Message</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          validateAndUpdateRecipient(index, 'message', '');
                          validateAndUpdateRecipient(index, 'showMessage', false);
                        }}
                        className="h-5 w-5 p-0 text-muted-foreground"
                      >
                        <XCircle className="h-3 w-3" />
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Optional message"
                      value={recipient.message}
                      onChange={(e) => validateAndUpdateRecipient(index, 'message', e.target.value)}
                      maxLength={1024}
                      rows={2}
                      className="text-xs resize-none"
                    />
                  </div>
                )}
              </Card>
            ))}
          </ScrollAreaContent>
        </ScrollArea>
      </div>

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
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-[#0000db]/20" />
                  <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#0000db] animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-[#0000db] animate-spin" />
                  </div>
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-base font-semibold">Sending ({txProgress.current}/{txProgress.total})</h3>
                  {txProgress.currentRecipient && (
                    <p className="text-xs text-muted-foreground font-mono">
                      oct...{txProgress.currentRecipient.slice(-10)} - {txProgress.currentAmount} OCT
                    </p>
                  )}
                </div>
                {/* Live results log */}
                {results.length > 0 && (
                  <ScrollArea className="w-full max-h-32">
                    <div className="space-y-1 pr-3">
                      {results.map((result, idx) => (
                        <div key={idx} className={`flex items-center gap-2 p-1.5 rounded text-xs ${result.success ? 'bg-[#0000db]/10 dark:bg-[#0000db]/20' : 'bg-red-50 dark:bg-red-950/50'}`}>
                          {result.success ? <CheckCircle className="h-3 w-3 text-[#0000db] flex-shrink-0" /> : <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                          <span className="font-mono truncate">oct...{result.recipient.slice(-10)}</span>
                          <span className="ml-auto">{result.amount} OCT</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
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
                <div className="w-16 h-16 rounded-full bg-[#0000db]/10 dark:bg-[#0000db]/20 flex items-center justify-center animate-in zoom-in-50 duration-300">
                  <CheckCircle className="w-10 h-10 text-[#0000db]" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-base font-semibold text-[#0000db]">All Sent!</h3>
                  <p className="text-xs text-muted-foreground">
                    {results.length} transaction(s) completed
                  </p>
                </div>
                <Badge variant="secondary" className="text-sm px-3 py-1">
                  {results.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(8)} OCT Total
                </Badge>
                {/* Elapsed Time */}
                {elapsedTime > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      Completed in {Math.floor(elapsedTime / 60) > 0 ? `${Math.floor(elapsedTime / 60)}m ` : ''}{(elapsedTime % 60).toFixed(1)}s
                    </span>
                  </div>
                )}
                {/* Results log */}
                <ScrollArea className="w-full max-h-40">
                  <div className="space-y-1 pr-3">
                    {results.map((result, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-1.5 rounded text-xs bg-[#0000db]/10 dark:bg-[#0000db]/20">
                        <CheckCircle className="h-3 w-3 text-[#0000db] flex-shrink-0" />
                        <span className="font-mono truncate">oct...{result.recipient.slice(-10)}</span>
                        <span className="ml-auto">{result.amount} OCT</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <Button onClick={handleModalClose} className="mt-2 bg-[#0000db] hover:bg-[#0000db]/90">
                  Close
                </Button>
              </>
            )}

            {/* Partial Success State */}
            {txModalStatus === 'partial' && (
              <>
                <div className="w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                  <AlertTriangle className="w-10 h-10 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-base font-semibold text-yellow-600 dark:text-yellow-400">Partial Success</h3>
                  <p className="text-xs text-muted-foreground">
                    {results.filter(r => r.success).length} sent, {results.filter(r => !r.success).length} failed
                  </p>
                </div>
                {/* Elapsed Time */}
                {elapsedTime > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      Completed in {Math.floor(elapsedTime / 60) > 0 ? `${Math.floor(elapsedTime / 60)}m ` : ''}{(elapsedTime % 60).toFixed(1)}s
                    </span>
                  </div>
                )}
                {/* Results log */}
                <ScrollArea className="w-full max-h-48">
                  <div className="space-y-1 pr-3">
                    {results.map((result, idx) => (
                      <div key={idx} className={`flex items-center gap-2 p-1.5 rounded text-xs ${result.success ? 'bg-[#0000db]/10 dark:bg-[#0000db]/20' : 'bg-red-50 dark:bg-red-950/50'}`}>
                        {result.success ? <CheckCircle className="h-3 w-3 text-[#0000db] flex-shrink-0" /> : <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                        <span className="font-mono truncate">oct...{result.recipient.slice(-10)}</span>
                        <span className="ml-auto">{result.amount} OCT</span>
                        {!result.success && result.error && (
                          <span className="text-red-500 truncate max-w-[100px]" title={result.error}>!</span>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <Button onClick={handleModalClose} variant="outline" className="mt-2">
                  Close
                </Button>
              </>
            )}

            {/* Error State */}
            {txModalStatus === 'error' && (
              <>
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center animate-in zoom-in-50 duration-300">
                  <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-base font-semibold text-red-600 dark:text-red-400">All Failed</h3>
                  <p className="text-xs text-muted-foreground">No transactions were sent successfully</p>
                </div>
                {/* Elapsed Time */}
                {elapsedTime > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      Completed in {Math.floor(elapsedTime / 60) > 0 ? `${Math.floor(elapsedTime / 60)}m ` : ''}{(elapsedTime % 60).toFixed(1)}s
                    </span>
                  </div>
                )}
                {/* Results log */}
                {results.length > 0 && (
                  <ScrollArea className="w-full max-h-40">
                    <div className="space-y-1 pr-3">
                      {results.map((result, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-1.5 rounded text-xs bg-red-50 dark:bg-red-950/50">
                          <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                          <span className="font-mono truncate">oct...{result.recipient.slice(-10)}</span>
                          <span className="ml-auto">{result.amount} OCT</span>
                        </div>
                      ))}

                    </div>
                  </ScrollArea>
                )}
                <Button onClick={handleModalClose} variant="outline" className="mt-2">
                  Close
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
