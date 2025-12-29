import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Upload, 
  AlertTriangle, 
  Wallet as WalletIcon, 
  CheckCircle, 
  Loader2, 
  Settings2, 
  XCircle, 
  ChevronDown,
  Trash2,
  FileText,
  Clock
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance, sendTransaction, createTransaction } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface FileRecipient {
  address: string;
  amount: string;
  isValid: boolean;
  error?: string;
}

interface TxLogEntry {
  recipient: string;
  amount: string;
  status: 'pending' | 'success' | 'error';
  hash?: string;
  error?: string;
  timestamp: Date;
}

interface MultiSendProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce?: number;
  onBalanceUpdate: (balance: number) => void;
  onNonceUpdate: (nonce: number) => void;
  onTransactionSuccess: () => void;
  onModalClose?: () => void;
  hideBorder?: boolean;
  resetTrigger?: number;
}

// Simple address validation function
function isOctraAddress(input: string): boolean {
  const addressRegex = /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/;
  return addressRegex.test(input);
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

export function FileMultiSend({ wallet, balance, onBalanceUpdate, onNonceUpdate, resetTrigger }: MultiSendProps) {
  const [recipients, setRecipients] = useState<FileRecipient[]>([]);
  const [amountMode, setAmountMode] = useState<'same' | 'different'>('same');
  const [sameAmount, setSameAmount] = useState('');
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [showOuSettings, setShowOuSettings] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [txLogs, setTxLogs] = useState<TxLogEntry[]>([]);
  const { toast } = useToast();

  // Reset all state when resetTrigger changes
  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      setRecipients([]);
      setTxLogs([]);
      setSameAmount('');
      setAmountMode('same');
      setOuOption('auto');
      setCustomOu('');
      setShowOuSettings(false);
      const fileInput = document.getElementById('bulkFileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
  }, [resetTrigger]);

  // Get OU value for a specific amount
  const getOuValue = (amount: number): number => {
    if (ouOption === 'auto') {
      return amount < 1000 ? 10000 : 30000;
    }
    if (ouOption === 'custom') return parseInt(customOu) || 10000;
    return parseInt(ouOption) || 10000;
  };

  // Calculate fee based on OU: OU * 0.0000001
  const calculateFee = (amount: number): number => {
    const ou = getOuValue(amount);
    return ou * 0.0000001;
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
        toast({ title: "Error", description: "File is empty or contains no valid lines", variant: "destructive" });
        const fileInput = document.getElementById('bulkFileInput') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        return;
      }
      
      const processedRecipients: FileRecipient[] = [];
      
      for (const line of lines) {
        let address = '';
        let amount = '';
        let error = '';

        if (amountMode === 'same') {
          address = line;
          amount = sameAmount;
        } else {
          const parts = line.split(/[,\s]+/);
          if (parts.length >= 2) {
            address = parts[0];
            amount = parts[1];
          } else {
            error = 'Invalid format. Expected "address,amount"';
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

    } catch {
      toast({ title: "Error", description: "Failed to process file", variant: "destructive" });
      const fileInput = document.getElementById('bulkFileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = useCallback((file: File) => {
    if (!file) return;

    if (!file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
      toast({ title: "Error", description: "Please upload a .txt or .csv file", variant: "destructive" });
      return;
    }

    if (amountMode === 'same' && !validateAmount(sameAmount)) {
      toast({ title: "Error", description: "Please enter a valid amount first", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      processFileContent(content);
    };
    reader.onerror = () => {
      toast({ title: "Error", description: "Failed to read file", variant: "destructive" });
    };
    reader.readAsText(file);
  }, [amountMode, sameAmount]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFileUpload(files[0]);
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

  const clearAllRecipients = () => {
    setRecipients([]);
    setTxLogs([]);
    const fileInput = document.getElementById('bulkFileInput') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
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

  const calculateTotalAmount = () => {
    return recipients
      .filter(r => r.isValid)
      .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  };

  const handleSendAll = async () => {
    if (!wallet) {
      toast({ title: "Error", description: "No wallet connected", variant: "destructive" });
      return;
    }

    const validRecipients = recipients.filter(r => r.isValid);
    if (validRecipients.length === 0) {
      toast({ title: "Error", description: "No valid recipients found", variant: "destructive" });
      return;
    }

    const totalCost = calculateTotalCost();
    if (balance !== null && totalCost > balance) {
      toast({ title: "Error", description: `Insufficient balance. Need ${totalCost.toFixed(8)} OCT`, variant: "destructive" });
      return;
    }

    setIsSending(true);
    setTxLogs([]);

    try {
      const freshBalanceData = await fetchBalance(wallet.address);
      let currentNonce = freshBalanceData.nonce;
      let successCount = 0;

      for (let i = 0; i < validRecipients.length; i++) {
        const recipient = validRecipients[i];
        const amount = parseFloat(recipient.amount);
        
        // Add pending log entry
        const pendingEntry: TxLogEntry = {
          recipient: recipient.address,
          amount: recipient.amount,
          status: 'pending',
          timestamp: new Date()
        };
        setTxLogs(prev => [...prev, pendingEntry]);
        
        try {
          const transaction = createTransaction(
            wallet.address,
            recipient.address.trim(),
            amount,
            currentNonce + 1,
            wallet.privateKey,
            wallet.publicKey || '',
            undefined,
            getOuValue(amount)
          );

          const sendResult = await sendTransaction(transaction);
          
          // Update log entry
          setTxLogs(prev => prev.map((log, idx) => 
            idx === prev.length - 1 
              ? { ...log, status: sendResult.success ? 'success' : 'error', hash: sendResult.hash, error: sendResult.error }
              : log
          ));

          if (sendResult.success) {
            currentNonce++;
            successCount++;
          }
        } catch (error) {
          setTxLogs(prev => prev.map((log, idx) => 
            idx === prev.length - 1 
              ? { ...log, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
              : log
          ));
        }
      }

      if (successCount > 0) {
        onNonceUpdate(currentNonce);
        
        setTimeout(async () => {
          try {
            const updatedBalance = await fetchBalance(wallet.address);
            onBalanceUpdate(updatedBalance.balance);
            onNonceUpdate(updatedBalance.nonce);
          } catch (error) {
            console.error('Failed to refresh balance:', error);
          }
        }, 2000);
      }
    } catch (error) {
      console.error('Multi-send error:', error);
      toast({ title: "Error", description: "Failed to send transactions", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
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

  const validRecipients = recipients.filter(r => r.isValid);
  const invalidRecipients = recipients.filter(r => !r.isValid);
  const totalCost = calculateTotalCost();
  const totalAmount = calculateTotalAmount();
  const currentBalance = balance || 0;
  const successCount = txLogs.filter(l => l.status === 'success').length;
  const errorCount = txLogs.filter(l => l.status === 'error').length;
  const pendingCount = txLogs.filter(l => l.status === 'pending').length;

  return (
    <div className="flex gap-6 h-full">
      {/* Left Panel - Wallet Info & Controls */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* Active Address */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Active Address</Label>
          <div className="p-2.5 bg-muted rounded-md font-mono text-xs break-all">
            {wallet.address}
          </div>
        </div>

        {/* Balance */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Balance</Label>
          <div className="p-2.5 bg-muted rounded-md font-mono text-sm font-medium">
            {currentBalance.toFixed(8)} OCT
          </div>
        </div>

        {/* Amount Configuration */}
        <div className="p-3 border rounded-lg space-y-3">
          <Label className="text-sm font-medium">Amount Configuration</Label>
          <RadioGroup value={amountMode} onValueChange={(value: 'same' | 'different') => setAmountMode(value)} className="space-y-2">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="same" id="same" />
              <Label htmlFor="same" className="text-xs cursor-pointer">Same amount for all</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="different" id="different" />
              <Label htmlFor="different" className="text-xs cursor-pointer">Different amounts (in file)</Label>
            </div>
          </RadioGroup>

          {amountMode === 'same' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Amount (OCT)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={sameAmount}
                onChange={(e) => setSameAmount(e.target.value)}
                step="0.1"
                min="0"
                className="h-9"
              />
            </div>
          )}
        </div>

        {/* OU Settings */}
        <Collapsible open={showOuSettings} onOpenChange={setShowOuSettings}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full flex items-center justify-between h-10">
              <span className="flex items-center gap-2 text-sm">
                <Settings2 className="h-4 w-4" />
                OU (Gas) Settings
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showOuSettings ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            <Select value={ouOption} onValueChange={setOuOption}>
              <SelectTrigger className="text-sm h-9">
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
                className="text-sm h-9"
              />
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Fee & Total Summary */}
        {validRecipients.length > 0 && (
          <div className="p-3 bg-muted/50 rounded-lg space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-mono">{totalAmount.toFixed(8)} OCT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee ({validRecipients.length}x)</span>
              <span className="font-mono">{(totalCost - totalAmount).toFixed(8)} OCT</span>
            </div>
            <div className="flex justify-between font-medium border-t pt-1.5 mt-1.5">
              <span>Total</span>
              <span className="font-mono">{totalCost.toFixed(8)} OCT</span>
            </div>
          </div>
        )}

        {/* Send Button */}
        <Button
          onClick={handleSendAll}
          disabled={isSending || validRecipients.length === 0 || totalCost > currentBalance}
          className="w-full h-11"
          size="lg"
        >
          {isSending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <span className="text-sm">
              Send to {validRecipients.length} recipient{validRecipients.length !== 1 ? 's' : ''} - {totalAmount.toFixed(4)} OCT
            </span>
          )}
        </Button>

        {totalCost > currentBalance && validRecipients.length > 0 && (
          <p className="text-xs text-red-500 text-center">
            Insufficient balance (need {totalCost.toFixed(4)} OCT)
          </p>
        )}
      </div>

      {/* Middle Panel - File Upload & Recipients */}
      <div className="w-[500px] flex-shrink-0 flex flex-col space-y-4 border-l pl-6">
        {/* Upload Recipients File */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`border-2 border-dashed rounded-lg py-8 px-6 text-center transition-colors ${
                  isDragOver 
                    ? 'border-[#0000db] bg-[#0000db]/5' 
                    : amountMode === 'same' && !validateAmount(sameAmount)
                    ? 'border-muted-foreground/20 bg-muted/30 cursor-not-allowed'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium mb-1">
                  {isDragOver ? 'Drop your file here' : 'Upload Recipients File'}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Drag & drop or click to browse (.txt, .csv)
                </p>
                <Input
                  type="file"
                  accept=".txt,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                  className="hidden"
                  id="bulkFileInput"
                />
                <Button
                  variant="outline"
                  onClick={() => document.getElementById('bulkFileInput')?.click()}
                  disabled={isProcessing || (amountMode === 'same' && !validateAmount(sameAmount))}
                  className="h-10 px-6"
                >
                  {isProcessing ? 'Processing...' : 'Browse Files'}
                </Button>
              </div>
            </TooltipTrigger>
            {amountMode === 'same' && !validateAmount(sameAmount) && (
              <TooltipContent>
                <p>Please input amount first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* File Format Instructions */}
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium">File Format</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {amountMode === 'same' ? (
              <>
                <p>• One address per line</p>
                <p>• Example: oct1abc...xyz</p>
              </>
            ) : (
              <>
                <p>• Format: address,amount</p>
                <p>• Example: oct1abc...xyz,10.5</p>
              </>
            )}
          </div>
        </div>

        {/* Recipients Preview */}
        <div className="border rounded-lg flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between p-3 border-b flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Recipients Preview</span>
              {recipients.length > 0 && (
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-green-600 text-xs">
                    {validRecipients.length} valid
                  </Badge>
                  {invalidRecipients.length > 0 && (
                    <Badge variant="outline" className="text-red-600 text-xs">
                      {invalidRecipients.length} invalid
                    </Badge>
                  )}
                </div>
              )}
            </div>
            {recipients.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllRecipients}
                className="h-7 text-xs text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
          </div>
          
          <ScrollArea className="flex-1">
            {recipients.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Upload className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No recipients loaded</p>
                <p className="text-xs">Upload a file to get started</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {recipients.map((recipient, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-2 rounded text-xs ${
                      recipient.isValid 
                        ? 'bg-green-50 dark:bg-green-950/30' 
                        : 'bg-red-50 dark:bg-red-950/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {recipient.isValid ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                      )}
                      <span className="font-mono truncate">
                        {recipient.address.slice(0, 12)}...{recipient.address.slice(-8)}
                      </span>
                      {recipient.error && (
                        <span className="text-red-500 truncate">({recipient.error})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-mono">{recipient.amount} OCT</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRecipient(index)}
                        className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Right Panel - Live Transaction Logs */}
      <div className="flex-1 border-l pl-6 flex flex-col">
        <div className="border rounded-lg flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between p-3 border-b flex-shrink-0">
            <span className="text-sm font-medium">Transaction Logs</span>
            {txLogs.length > 0 && (
              <div className="flex gap-1">
                {successCount > 0 && (
                  <Badge variant="outline" className="text-green-600 text-xs">{successCount}</Badge>
                )}
                {errorCount > 0 && (
                  <Badge variant="outline" className="text-red-600 text-xs">{errorCount}</Badge>
                )}
                {pendingCount > 0 && (
                  <Badge variant="outline" className="text-yellow-600 text-xs">{pendingCount}</Badge>
                )}
              </div>
            )}
          </div>
          
          <ScrollArea className="flex-1">
            {txLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Clock className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No transactions yet</p>
                <p className="text-xs">Logs will appear here</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {txLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`p-2 rounded text-xs ${
                      log.status === 'success' 
                        ? 'bg-green-50 dark:bg-green-950/30' 
                        : log.status === 'error'
                        ? 'bg-red-50 dark:bg-red-950/30'
                        : 'bg-yellow-50 dark:bg-yellow-950/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {log.status === 'success' && <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                      {log.status === 'error' && <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                      {log.status === 'pending' && <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin flex-shrink-0" />}
                      <span className="font-mono truncate flex-1">
                        {log.recipient.slice(0, 8)}...{log.recipient.slice(-6)}
                      </span>
                      <span className="font-mono">{log.amount} OCT</span>
                    </div>
                    {log.hash && (
                      <a 
                        href={`https://octrascan.io/transactions/${log.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#0000db] hover:underline mt-1 block truncate"
                      >
                        {log.hash.slice(0, 16)}...
                      </a>
                    )}
                    {log.error && (
                      <p className="text-[10px] text-red-500 mt-1 truncate">{log.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}