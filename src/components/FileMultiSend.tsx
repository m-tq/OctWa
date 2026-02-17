import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea, ScrollAreaContent } from '@/components/ui/scroll-area';
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
import { fetchBalance, sendTransaction, createTransaction, fetchCurrentEpoch, invalidateCacheAfterTransaction } from '../utils/api';
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
  status: 'pending' | 'success' | 'error' | 'retrying' | 'queued';
  hash?: string;
  error?: string;
  timestamp: Date;
  retryCount?: number;
  batchRound?: number;
  txIndex?: number; // Original transaction index for numbering
}

interface SummaryLogEntry {
  type: 'summary';
  successCount: number;
  errorCount: number;
  totalTime: number;
  totalBatches: number;
  timestamp: Date;
}

interface BatchLogEntry {
  type: 'batch';
  batchNumber: number;
  totalInBatch: number;
  successInBatch: number;
  failedInBatch: number;
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
  sidebarOpen?: boolean;
  historySidebarOpen?: boolean;
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

export function FileMultiSend({ wallet, balance, onBalanceUpdate, onNonceUpdate, resetTrigger, sidebarOpen = true, historySidebarOpen = true }: MultiSendProps) {
  const [recipients, setRecipients] = useState<FileRecipient[]>([]);
  const [amountMode, setAmountMode] = useState<'same' | 'different'>('same');
  const [sameAmount, setSameAmount] = useState('');
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [showOuSettings, setShowOuSettings] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [txLogs, setTxLogs] = useState<(TxLogEntry | SummaryLogEntry | BatchLogEntry)[]>([]);
  const [executionMode, setExecutionMode] = useState<'parallel' | 'sequential'>('parallel');
  const txLogsEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const scannerUrl = import.meta.env.VITE_SCANNER_URL || 'https://octrascan.io/transactions/';

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (txLogsEndRef.current) {
      txLogsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [txLogs]);

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
      setExecutionMode('parallel');
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

    let startTime = 0; // Will be set when first transaction is submitted
    const BATCH_SIZE = 50; // Send 50 transactions per batch
    const BATCH_RETRY_DELAY = 5000; // 5 seconds delay before retrying failed batch

    // Helper function to fetch nonce with retry
    const fetchNonceWithRetry = async (maxAttempts = 5): Promise<number> => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          console.log(`[Nonce] Fetching nonce, attempt ${attempt + 1}/${maxAttempts}`);
          const balanceData = await fetchBalance(wallet.address);
          console.log(`[Nonce] Got nonce: ${balanceData.nonce}`);
          return balanceData.nonce;
        } catch (error) {
          console.error(`[Nonce] Fetch failed, attempt ${attempt + 1}:`, error);
          if (attempt === maxAttempts - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      throw new Error('Failed to fetch nonce');
    };

    // Helper function to fetch epoch with retry
    const fetchEpochWithRetry = async (maxAttempts = 5): Promise<number> => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          console.log(`[Epoch] Fetching epoch, attempt ${attempt + 1}/${maxAttempts}`);
          const epoch = await fetchCurrentEpoch();
          console.log(`[Epoch] Got epoch: ${epoch}`);
          return epoch;
        } catch (error) {
          console.error(`[Epoch] Fetch failed, attempt ${attempt + 1}:`, error);
          if (attempt === maxAttempts - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      throw new Error('Failed to fetch epoch');
    };



    // Helper function to send a batch and return results
    const sendBatch = async (
      batchWithNonce: BatchRecipient[],
      batchNum: number
    ): Promise<{ recipient: BatchRecipient; success: boolean; hash?: string; error?: string }[]> => {
      return Promise.all(
        batchWithNonce.map(async (recipient) => {
          try {
            const amount = parseFloat(recipient.amount);
            const transaction = createTransaction(
              wallet.address,
              recipient.address.trim(),
              amount,
              recipient.assignedNonce!,
              wallet.privateKey,
              wallet.publicKey || '',
              undefined,
              getOuValue(amount)
            );
            const result = await sendTransaction(transaction);
            console.log(`[Batch ${batchNum}] TX nonce=${recipient.assignedNonce}: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.error || result.hash?.slice(0, 16)}`);
            return { recipient, success: result.success, hash: result.hash, error: result.error };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Batch ${batchNum}] TX nonce=${recipient.assignedNonce}: ERROR - ${errorMsg}`);
            return { recipient, success: false, hash: undefined, error: errorMsg };
          }
        })
      );
    };

    // Define recipient type for batch processing
    type BatchRecipient = { address: string; amount: string; originalIndex: number; isValid: boolean; error?: string; assignedNonce?: number };

    try {
      // Initialize all recipients with original index
      const allRecipients: BatchRecipient[] = validRecipients.map((r, idx) => ({
        ...r,
        originalIndex: idx
      }));

      // Add all recipients to log as queued with their original index
      setTxLogs(allRecipients.map((r, idx) => ({
        recipient: r.address,
        amount: r.amount,
        status: 'queued' as const,
        timestamp: new Date(),
        batchRound: 0,
        txIndex: idx + 1 // 1-based index
      })));

      let totalSuccessCount = 0;
      let batchNumber = 0;
      let failedRecipients: BatchRecipient[] = [];
      let lastSuccessfulNonce = 0; // Track last successful nonce

      // Step 1: Fetch initial epoch
      let currentEpoch = await fetchEpochWithRetry();
      console.log(`[Start] Initial epoch: ${currentEpoch}, Total recipients: ${allRecipients.length}`);

      // Step 2: Process all recipients in batches of BATCH_SIZE
      let currentIndex = 0;
      let isFirstBatch = true;

      while (currentIndex < allRecipients.length) {
        batchNumber++;
        const batchStart = currentIndex;
        const batchEnd = Math.min(currentIndex + BATCH_SIZE, allRecipients.length);
        const currentBatch = allRecipients.slice(batchStart, batchEnd);

        // For first batch: fetch fresh nonce
        // For subsequent batches: use lastSuccessfulNonce as base (no fetch needed)
        let batchBaseNonce: number;
        if (isFirstBatch) {
          batchBaseNonce = await fetchNonceWithRetry();
          console.log(`\n[Batch ${batchNumber}] First batch - Fresh nonce: ${batchBaseNonce}`);
        } else {
          batchBaseNonce = lastSuccessfulNonce;
          console.log(`\n[Batch ${batchNumber}] Using last successful nonce as base: ${batchBaseNonce}`);
        }
        
        // Pre-assign nonces for this batch
        let batchWithNonce = currentBatch.map((r, idx) => ({
          ...r,
          assignedNonce: batchBaseNonce + idx + 1
        }));

        console.log(`[Batch ${batchNumber}] Processing recipients ${batchStart + 1}-${batchEnd} of ${allRecipients.length}`);
        console.log(`[Batch ${batchNumber}] Nonces: ${batchWithNonce[0].assignedNonce} to ${batchWithNonce[batchWithNonce.length - 1].assignedNonce}`);

        // Add batch start log
        setTxLogs(prev => [...prev, {
          type: 'batch' as const,
          batchNumber,
          totalInBatch: currentBatch.length,
          successInBatch: 0,
          failedInBatch: 0,
          timestamp: new Date()
        }]);

        // Update batch recipients to 'pending' status
        setTxLogs(prev => prev.map(log => {
          if ('recipient' in log && currentBatch.some(r => r.address === log.recipient)) {
            return { ...log, status: 'pending' as const, batchRound: batchNumber, error: undefined };
          }
          return log;
        }));

        // Start timer when first batch is about to be sent
        if (batchNumber === 1) {
          startTime = Date.now();
        }

        // Send the batch
        let batchResults = await sendBatch(batchWithNonce, batchNumber);

        // For first batch: if ALL failed, retry with same data after 5s sleep
        if (isFirstBatch) {
          const allFailed = batchResults.every(r => !r.success);
          if (allFailed) {
            console.log(`[Batch ${batchNumber}] First batch ALL FAILED - retrying with same data after ${BATCH_RETRY_DELAY}ms...`);
            
            // Update status to retrying
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && currentBatch.some(r => r.address === log.recipient)) {
                return { ...log, status: 'retrying' as const, error: `Retrying in ${BATCH_RETRY_DELAY/1000}s...` };
              }
              return log;
            }));

            await new Promise(resolve => setTimeout(resolve, BATCH_RETRY_DELAY));
            
            // Update status back to pending
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && currentBatch.some(r => r.address === log.recipient)) {
                return { ...log, status: 'pending' as const, error: undefined };
              }
              return log;
            }));

            // Retry with same nonces
            batchResults = await sendBatch(batchWithNonce, batchNumber);
          }
        } else {
          // For subsequent batches (batch 2+): retry logic with epoch check
          const BATCH_SLEEP_DELAY = 10000; // 10 seconds
          let batchRetryCount = 0;
          const MAX_BATCH_RETRIES = 10;
          
          while (batchResults.every(r => !r.success) && batchRetryCount < MAX_BATCH_RETRIES) {
            batchRetryCount++;
            console.log(`[Batch ${batchNumber}] ALL FAILED - retry ${batchRetryCount}, checking epoch...`);
            
            // Update status to retrying
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && currentBatch.some(r => r.address === log.recipient)) {
                return { ...log, status: 'retrying' as const, error: `Retry ${batchRetryCount}, waiting 10s...` };
              }
              return log;
            }));

            // Sleep 10s
            await new Promise(resolve => setTimeout(resolve, BATCH_SLEEP_DELAY));
            
            // Check if epoch changed
            let epochChanged = false;
            try {
              const newEpoch = await fetchCurrentEpoch();
              if (newEpoch > currentEpoch) {
                console.log(`[Batch ${batchNumber}] Epoch changed: ${currentEpoch} -> ${newEpoch}`);
                currentEpoch = newEpoch;
                epochChanged = true;
              }
            } catch (error) {
              console.error(`[Batch ${batchNumber}] Error checking epoch:`, error);
            }
            
            // If epoch changed, fetch fresh nonce and reassign
            if (epochChanged) {
              console.log(`[Batch ${batchNumber}] Fetching fresh nonce after epoch change...`);
              batchBaseNonce = await fetchNonceWithRetry();
              lastSuccessfulNonce = batchBaseNonce;
              
              // Reassign nonces with new base
              batchWithNonce = currentBatch.map((r, idx) => ({
                ...r,
                assignedNonce: batchBaseNonce + idx + 1
              }));
              console.log(`[Batch ${batchNumber}] New nonces: ${batchWithNonce[0].assignedNonce} to ${batchWithNonce[batchWithNonce.length - 1].assignedNonce}`);
            }
            
            // Update status back to pending
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && currentBatch.some(r => r.address === log.recipient)) {
                return { ...log, status: 'pending' as const, error: undefined };
              }
              return log;
            }));

            // Retry batch
            batchResults = await sendBatch(batchWithNonce, batchNumber);
          }
        }

        // Process results
        let batchSuccessCount = 0;
        let batchFailCount = 0;
        let highestSuccessNonce = batchBaseNonce;

        for (const result of batchResults) {
          if (result.success) {
            batchSuccessCount++;
            totalSuccessCount++;
            // Track highest successful nonce
            if (result.recipient.assignedNonce! > highestSuccessNonce) {
              highestSuccessNonce = result.recipient.assignedNonce!;
            }
            
            // Update log to success
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === result.recipient.address) {
                return { ...log, status: 'success' as const, hash: result.hash, error: undefined };
              }
              return log;
            }));
          } else {
            batchFailCount++;
            failedRecipients.push(result.recipient);
            
            // Update log to error
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === result.recipient.address && log.status !== 'success') {
                return { ...log, status: 'error' as const, error: result.error };
              }
              return log;
            }));
          }
        }

        // Update lastSuccessfulNonce if we had any success
        if (batchSuccessCount > 0) {
          lastSuccessfulNonce = highestSuccessNonce;
          console.log(`[Batch ${batchNumber}] Updated lastSuccessfulNonce to: ${lastSuccessfulNonce}`);
        }

        console.log(`[Batch ${batchNumber}] Results: ${batchSuccessCount} success, ${batchFailCount} failed`);

        // Update batch log with results
        setTxLogs(prev => prev.map(log => {
          if ('type' in log && log.type === 'batch' && log.batchNumber === batchNumber) {
            return { ...log, successInBatch: batchSuccessCount, failedInBatch: batchFailCount };
          }
          return log;
        }));

        currentIndex = batchEnd;
        
        // After first batch, sleep 10s before next batch
        if (isFirstBatch && currentIndex < allRecipients.length) {
          console.log(`[Batch ${batchNumber}] First batch done. Sleeping 10s before batch 2...`);
          
          // Update remaining recipients to show waiting status
          const remainingRecipients = allRecipients.slice(currentIndex);
          setTxLogs(prev => prev.map(log => {
            if ('recipient' in log && remainingRecipients.some(r => r.address === log.recipient) && log.status === 'queued') {
              return { ...log, error: 'Waiting 10s before next batch...' };
            }
            return log;
          }));
          
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10s sleep
        }
        
        isFirstBatch = false;
      }

      // Step 3: Retry failed transactions - retry with same data every 5s, if epoch changes fetch new nonce
      let retryRound = 0;
      const MAX_RETRY_ROUNDS = 10;
      
      while (failedRecipients.length > 0 && retryRound < MAX_RETRY_ROUNDS) {
        retryRound++;
        console.log(`\n[Retry ${retryRound}] ${failedRecipients.length} failed transactions to retry`);

        // Move failed transactions to bottom of log by removing and re-adding them
        const failedAddresses = failedRecipients.map(r => r.address);
        setTxLogs(prev => {
          const nonFailedLogs = prev.filter(log => !('recipient' in log) || !failedAddresses.includes(log.recipient));
          const failedLogs = prev.filter(log => 'recipient' in log && failedAddresses.includes(log.recipient));
          // Update failed logs to retrying status
          const updatedFailedLogs = failedLogs.map(log => ({
            ...log,
            status: 'retrying' as const,
            error: `Retry ${retryRound}, waiting ${BATCH_RETRY_DELAY/1000}s...`
          }));
          return [...nonFailedLogs, ...updatedFailedLogs];
        });

        // Wait 5 seconds before retry
        console.log(`[Retry ${retryRound}] Waiting ${BATCH_RETRY_DELAY}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_RETRY_DELAY));

        // Check if epoch changed during wait
        let epochChanged = false;
        try {
          const newEpoch = await fetchCurrentEpoch();
          if (newEpoch > currentEpoch) {
            console.log(`[Retry ${retryRound}] Epoch changed: ${currentEpoch} -> ${newEpoch}`);
            currentEpoch = newEpoch;
            epochChanged = true;
          }
        } catch (error) {
          console.error(`[Retry ${retryRound}] Error checking epoch:`, error);
        }

        // If epoch changed, fetch fresh nonce and reassign
        let retryBaseNonce: number;
        if (epochChanged) {
          console.log(`[Retry ${retryRound}] Fetching fresh nonce after epoch change...`);
          retryBaseNonce = await fetchNonceWithRetry();
          console.log(`[Retry ${retryRound}] Got fresh nonce: ${retryBaseNonce}`);
        } else {
          // Use last successful nonce as base (keep same nonces for retry)
          retryBaseNonce = lastSuccessfulNonce;
          console.log(`[Retry ${retryRound}] Using last successful nonce: ${retryBaseNonce}`);
        }

        // Re-assign nonces to failed recipients
        const retryRecipients: BatchRecipient[] = failedRecipients.map((r, idx) => ({
          ...r,
          assignedNonce: retryBaseNonce + idx + 1
        }));
        failedRecipients = [];

        console.log(`[Retry ${retryRound}] Re-assigned nonces: ${retryBaseNonce + 1} to ${retryBaseNonce + retryRecipients.length}`);

        // Process retry recipients in batches
        let retryIndex = 0;
        let retryLastSuccessNonce = retryBaseNonce;

        while (retryIndex < retryRecipients.length) {
          batchNumber++;
          const batchStart = retryIndex;
          const batchEnd = Math.min(retryIndex + BATCH_SIZE, retryRecipients.length);
          const currentBatch = retryRecipients.slice(batchStart, batchEnd);

          console.log(`[Retry ${retryRound} Batch ${batchNumber}] Retrying ${currentBatch.length} transactions`);

          // Add batch start log
          setTxLogs(prev => [...prev, {
            type: 'batch' as const,
            batchNumber,
            totalInBatch: currentBatch.length,
            successInBatch: 0,
            failedInBatch: 0,
            timestamp: new Date()
          }]);

          // Update batch recipients to 'pending' status
          setTxLogs(prev => prev.map(log => {
            if ('recipient' in log && currentBatch.some(r => r.address === log.recipient)) {
              return { ...log, status: 'pending' as const, batchRound: batchNumber, error: undefined };
            }
            return log;
          }));

          // Send the batch
          const batchResults = await sendBatch(currentBatch, batchNumber);

          // Process results
          let batchSuccessCount = 0;
          let batchFailCount = 0;

          for (const result of batchResults) {
            if (result.success) {
              batchSuccessCount++;
              totalSuccessCount++;
              if (result.recipient.assignedNonce! > retryLastSuccessNonce) {
                retryLastSuccessNonce = result.recipient.assignedNonce!;
              }
              
              setTxLogs(prev => prev.map(log => {
                if ('recipient' in log && log.recipient === result.recipient.address) {
                  return { ...log, status: 'success' as const, hash: result.hash, error: undefined };
                }
                return log;
              }));
            } else {
              batchFailCount++;
              failedRecipients.push(result.recipient);
              
              setTxLogs(prev => prev.map(log => {
                if ('recipient' in log && log.recipient === result.recipient.address && log.status !== 'success') {
                  return { ...log, status: 'error' as const, error: result.error, retryCount: retryRound };
                }
                return log;
              }));
            }
          }

          // Update lastSuccessfulNonce if we had success
          if (batchSuccessCount > 0) {
            lastSuccessfulNonce = retryLastSuccessNonce;
          }

          console.log(`[Retry ${retryRound} Batch ${batchNumber}] Results: ${batchSuccessCount} success, ${batchFailCount} failed`);

          // Update batch log with results
          setTxLogs(prev => prev.map(log => {
            if ('type' in log && log.type === 'batch' && log.batchNumber === batchNumber) {
              return { ...log, successInBatch: batchSuccessCount, failedInBatch: batchFailCount };
            }
            return log;
          }));

          retryIndex = batchEnd;
        }
      }

      // Calculate final results
      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;
      const finalErrorCount = failedRecipients.length;

      console.log(`\n[Complete] Total: ${totalSuccessCount} success, ${finalErrorCount} failed, ${batchNumber} batches, ${elapsedTime.toFixed(1)}s`);

      // Add summary log entry
      setTxLogs(prev => [...prev, {
        type: 'summary' as const,
        successCount: totalSuccessCount,
        errorCount: finalErrorCount,
        totalTime: elapsedTime,
        totalBatches: batchNumber,
        timestamp: new Date()
      }]);

      if (totalSuccessCount > 0) {
        // Fetch final balance
        try {
          await invalidateCacheAfterTransaction(wallet.address);
          const finalBalance = await fetchBalance(wallet.address, true);
          onNonceUpdate(finalBalance.nonce);
          onBalanceUpdate(finalBalance.balance);
        } catch (error) {
          console.error('Failed to refresh balance:', error);
        }
      }
    } catch (error) {
      console.error('Multi-send error:', error);
      toast({ title: "Error", description: "Failed to send transactions", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  // Sequential send - one transaction at a time
  const handleSendAllSequential = async () => {
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

    let startTime = 0; // Will be set when first transaction is submitted
    const MAX_RETRIES = 10; // Increased retries
    const RETRY_DELAY = 5000; // 5 seconds delay before retry
    const EPOCH_CHECK_INTERVAL = 5000;

    // Helper function to fetch nonce with retry
    const fetchNonceWithRetry = async (maxAttempts = 5): Promise<number> => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          console.log(`[Sequential][Nonce] Fetching nonce, attempt ${attempt + 1}/${maxAttempts}`);
          const balanceData = await fetchBalance(wallet.address);
          console.log(`[Sequential][Nonce] Got nonce: ${balanceData.nonce}`);
          return balanceData.nonce;
        } catch (error) {
          console.error(`[Sequential][Nonce] Fetch failed, attempt ${attempt + 1}:`, error);
          if (attempt === maxAttempts - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      throw new Error('Failed to fetch nonce');
    };

    // Helper function to fetch epoch with retry
    const fetchEpochWithRetry = async (maxAttempts = 5): Promise<number> => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const epoch = await fetchCurrentEpoch();
          return epoch;
        } catch (error) {
          if (attempt === maxAttempts - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      throw new Error('Failed to fetch epoch');
    };

    // Helper function to wait for epoch change
    const waitForEpochChange = async (currentEpoch: number): Promise<number> => {
      console.log(`[Sequential][Epoch] Waiting for epoch to change from ${currentEpoch}...`);
      while (true) {
        await new Promise(resolve => setTimeout(resolve, EPOCH_CHECK_INTERVAL));
        try {
          const newEpoch = await fetchCurrentEpoch();
          if (newEpoch > currentEpoch) {
            console.log(`[Sequential][Epoch] Epoch changed: ${currentEpoch} -> ${newEpoch}`);
            return newEpoch;
          }
        } catch (error) {
          console.error(`[Sequential][Epoch] Error checking epoch:`, error);
        }
      }
    };

    type SeqRecipient = { address: string; amount: string; originalIndex: number };

    try {
      // Initialize recipients
      const allRecipients: SeqRecipient[] = validRecipients.map((r, idx) => ({
        address: r.address,
        amount: r.amount,
        originalIndex: idx
      }));

      // For sequential mode, don't add all logs at once - add them one by one
      // Start with empty logs
      setTxLogs([]);

      let totalSuccessCount = 0;
      let currentEpoch = await fetchEpochWithRetry();
      let currentNonce = await fetchNonceWithRetry();
      let failedRecipients: SeqRecipient[] = [];

      console.log(`[Sequential][Start] Initial epoch: ${currentEpoch}, nonce: ${currentNonce}, recipients: ${allRecipients.length}`);

      // Process each recipient one by one
      for (let i = 0; i < allRecipients.length; i++) {
        const recipient = allRecipients[i];
        
        // Add this recipient to log as pending (sequential - one at a time)
        setTxLogs(prev => [...prev, {
          recipient: recipient.address,
          amount: recipient.amount,
          status: 'pending' as const,
          timestamp: new Date(),
          txIndex: i + 1 // 1-based index
        }]);

        let txSuccess = false;
        let txHash = '';
        let lastError = '';
        let retryCount = 0;
        let epochRetried = false;
        let txNonce = currentNonce + 1; // Store the nonce for this transaction

        // Try with retries: sleep 5s and retry with SAME nonce, until epoch changes then fetch new nonce
        while (!txSuccess) {
          if (retryCount > 0) {
            console.log(`[Sequential] TX ${i + 1} retry ${retryCount}, sleeping ${RETRY_DELAY}ms...`);
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === recipient.address) {
                return { ...log, status: 'retrying' as const, error: `Retry ${retryCount}, waiting ${RETRY_DELAY/1000}s...`, retryCount };
              }
              return log;
            }));
            
            // Sleep 5 seconds before retry
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            
            // Check if epoch changed
            try {
              const newEpoch = await fetchCurrentEpoch();
              if (newEpoch > currentEpoch) {
                console.log(`[Sequential] Epoch changed during retry: ${currentEpoch} -> ${newEpoch}`);
                currentEpoch = newEpoch;
                epochRetried = true;
                // Fetch fresh nonce after epoch change
                currentNonce = await fetchNonceWithRetry();
                txNonce = currentNonce + 1; // Update nonce for retry
                console.log(`[Sequential] Updated nonce after epoch change: ${txNonce}`);
              }
              // If epoch didn't change, keep using the same nonce
            } catch (error) {
              console.error(`[Sequential] Error checking epoch during retry:`, error);
            }

            // Update status back to pending
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === recipient.address) {
                return { ...log, status: 'pending' as const, error: undefined };
              }
              return log;
            }));
          }

          try {
            const amount = parseFloat(recipient.amount);
            
            // Start timer when first transaction is about to be submitted
            if (i === 0 && retryCount === 0) {
              startTime = Date.now();
            }
            
            console.log(`[Sequential] TX ${i + 1}/${allRecipients.length}: ${recipient.address.slice(0, 10)}... nonce=${txNonce}`);
            
            const transaction = createTransaction(
              wallet.address,
              recipient.address.trim(),
              amount,
              txNonce,
              wallet.privateKey,
              wallet.publicKey || '',
              undefined,
              getOuValue(amount)
            );

            const result = await sendTransaction(transaction);

            if (result.success) {
              txSuccess = true;
              txHash = result.hash || '';
              currentNonce = txNonce; // Update nonce on success
              console.log(`[Sequential] TX ${i + 1} SUCCESS: ${txHash.slice(0, 16)}`);
            } else {
              lastError = result.error || 'Transaction failed';
              console.log(`[Sequential] TX ${i + 1} FAILED: ${lastError}`);
              retryCount++;
              
              // If we already retried after epoch change and still failed, move to failed list
              if (epochRetried && retryCount > MAX_RETRIES) {
                console.log(`[Sequential] TX ${i + 1} failed after epoch change, moving to failed list`);
                break;
              }
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Sequential] TX ${i + 1} ERROR: ${lastError}`);
            retryCount++;
            
            if (epochRetried && retryCount > MAX_RETRIES) {
              break;
            }
          }

          // If too many retries without epoch change, wait for epoch change
          if (!txSuccess && retryCount >= MAX_RETRIES && !epochRetried) {
            console.log(`[Sequential] TX ${i + 1} max retries reached, waiting for epoch change...`);
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === recipient.address) {
                return { ...log, status: 'retrying' as const, error: 'Waiting for epoch change...' };
              }
              return log;
            }));
            
            currentEpoch = await waitForEpochChange(currentEpoch);
            epochRetried = true;
            currentNonce = await fetchNonceWithRetry();
            txNonce = currentNonce + 1; // Update nonce after epoch change
            retryCount = 0; // Reset retry count after epoch change
          }
        }

        if (txSuccess) {
          totalSuccessCount++;
          setTxLogs(prev => prev.map(log => {
            if ('recipient' in log && log.recipient === recipient.address) {
              return { ...log, status: 'success' as const, hash: txHash, error: undefined };
            }
            return log;
          }));
        } else {
          // After all retries failed, add to failed list for final epoch-based retry
          // Move failed transaction to bottom of log
          setTxLogs(prev => {
            const otherLogs = prev.filter(log => !('recipient' in log) || log.recipient !== recipient.address);
            const failedLog = prev.find(log => 'recipient' in log && log.recipient === recipient.address);
            if (failedLog && 'recipient' in failedLog) {
              return [...otherLogs, { ...failedLog, status: 'error' as const, error: lastError, retryCount }];
            }
            return prev;
          });
          failedRecipients.push(recipient);
        }
      }

      // Final retry for remaining failed transactions
      // Use last successful nonce, retry every 5s, only fetch new nonce after epoch change
      let finalRetryRound = 0;
      const MAX_FINAL_RETRIES = 10;

      while (failedRecipients.length > 0 && finalRetryRound < MAX_FINAL_RETRIES) {
        finalRetryRound++;
        console.log(`\n[Sequential][FinalRetry ${finalRetryRound}] ${failedRecipients.length} failed transactions`);

        // Move failed transactions to bottom of log
        const failedAddresses = failedRecipients.map(r => r.address);
        setTxLogs(prev => {
          const nonFailedLogs = prev.filter(log => !('recipient' in log) || !failedAddresses.includes(log.recipient));
          const failedLogs = prev.filter(log => 'recipient' in log && failedAddresses.includes(log.recipient));
          const updatedFailedLogs = failedLogs.map(log => ({
            ...log,
            status: 'retrying' as const,
            error: `Retry round ${finalRetryRound}, waiting ${RETRY_DELAY/1000}s...`
          }));
          return [...nonFailedLogs, ...updatedFailedLogs];
        });

        // Wait 5s before retry (don't wait for epoch change)
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

        // Check if epoch changed during wait
        let epochChanged = false;
        try {
          const newEpoch = await fetchCurrentEpoch();
          if (newEpoch > currentEpoch) {
            console.log(`[Sequential][FinalRetry] Epoch changed: ${currentEpoch} -> ${newEpoch}`);
            currentEpoch = newEpoch;
            epochChanged = true;
            // Only fetch new nonce after epoch change
            currentNonce = await fetchNonceWithRetry();
            console.log(`[Sequential][FinalRetry] Fresh nonce after epoch change: ${currentNonce}`);
          }
        } catch (error) {
          console.error(`[Sequential][FinalRetry] Error checking epoch:`, error);
        }

        // Use last successful nonce as base (currentNonce already tracks this)
        console.log(`[Sequential][FinalRetry ${finalRetryRound}] Using nonce base: ${currentNonce}, epochChanged: ${epochChanged}`);

        const recipientsToRetry = [...failedRecipients];
        failedRecipients = [];

        for (const recipient of recipientsToRetry) {
          setTxLogs(prev => prev.map(log => {
            if ('recipient' in log && log.recipient === recipient.address) {
              return { ...log, status: 'pending' as const, error: undefined };
            }
            return log;
          }));

          const txNonce = currentNonce + 1;
          let txSuccess = false;
          let txHash = '';
          let lastError = '';

          try {
            const amount = parseFloat(recipient.amount);

            console.log(`[Sequential][FinalRetry ${finalRetryRound}] TX: ${recipient.address.slice(0, 10)}... nonce=${txNonce}`);

            const transaction = createTransaction(
              wallet.address,
              recipient.address.trim(),
              amount,
              txNonce,
              wallet.privateKey,
              wallet.publicKey || '',
              undefined,
              getOuValue(amount)
            );

            const result = await sendTransaction(transaction);

            if (result.success) {
              txSuccess = true;
              txHash = result.hash || '';
              currentNonce = txNonce; // Update nonce on success
              console.log(`[Sequential][FinalRetry ${finalRetryRound}] TX SUCCESS: ${recipient.address.slice(0, 10)}...`);
            } else {
              lastError = result.error || 'Transaction failed';
              console.log(`[Sequential][FinalRetry ${finalRetryRound}] TX FAILED: ${lastError}`);
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Sequential][FinalRetry ${finalRetryRound}] TX ERROR: ${lastError}`);
          }

          if (txSuccess) {
            totalSuccessCount++;
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === recipient.address) {
                return { ...log, status: 'success' as const, hash: txHash, error: undefined };
              }
              return log;
            }));
          } else {
            failedRecipients.push(recipient);
            setTxLogs(prev => prev.map(log => {
              if ('recipient' in log && log.recipient === recipient.address) {
                return { ...log, status: 'error' as const, error: lastError };
              }
              return log;
            }));
          }
        }
      }

      // Calculate final results
      const endTime = Date.now();
      const elapsedTime = (endTime - startTime) / 1000;
      const finalErrorCount = failedRecipients.length;

      console.log(`\n[Sequential][Complete] Total: ${totalSuccessCount} success, ${finalErrorCount} failed, ${elapsedTime.toFixed(1)}s`);

      // Add summary log entry
      setTxLogs(prev => [...prev, {
        type: 'summary' as const,
        successCount: totalSuccessCount,
        errorCount: finalErrorCount,
        totalTime: elapsedTime,
        totalBatches: 1,
        timestamp: new Date()
      }]);

      if (totalSuccessCount > 0) {
        try {
          await invalidateCacheAfterTransaction(wallet.address);
          const finalBalance = await fetchBalance(wallet.address, true);
          onNonceUpdate(finalBalance.nonce);
          onBalanceUpdate(finalBalance.balance);
        } catch (error) {
          console.error('Failed to refresh balance:', error);
        }
      }
    } catch (error) {
      console.error('Sequential send error:', error);
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
  const txLogEntries = txLogs.filter((l): l is TxLogEntry => 'recipient' in l);
  const successCount = txLogEntries.filter(l => l.status === 'success').length;
  const errorCount = txLogEntries.filter(l => l.status === 'error').length;
  const pendingCount = txLogEntries.filter(l => l.status === 'pending' || l.status === 'retrying' || l.status === 'queued').length;

  // Determine layout based on sidebar states
  const bothSidebarsOpen = sidebarOpen && historySidebarOpen;
  const oneSidebarOpen = sidebarOpen || historySidebarOpen;

  return (
    <div className={`h-full flex flex-col gap-2 overflow-auto ${
      bothSidebarsOpen 
        ? 'lg:flex-col' 
        : oneSidebarOpen 
          ? 'xl:flex-row xl:gap-4 xl:overflow-hidden' 
          : 'lg:flex-row lg:gap-4 lg:overflow-hidden'
    }`}>
      {/* Left Panel - Wallet Info & Controls */}
      <div className={`w-full flex-shrink-0 space-y-4 overflow-visible ${
        bothSidebarsOpen 
          ? 'lg:w-full' 
          : oneSidebarOpen 
            ? 'xl:w-72' 
            : 'lg:w-72'
      }`}>
          {/* Active Address & Balance */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Active Address</Label>
            <div className="p-2.5 bg-muted  font-mono text-xs">
              {wallet.address.slice(0, 10)}...{wallet.address.slice(-6)} | {currentBalance.toFixed(4)} OCT
            </div>
          </div>

          {/* Amount Configuration */}
          <div className="p-3 border  space-y-3">
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
          <CollapsibleContent className="pt-2 px-0.5 space-y-2">
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
          <div className="p-3 bg-muted/50  space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-mono">{totalAmount.toFixed(8)} OCT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee ({validRecipients.length}x)</span>
              <span className="font-mono">{(totalCost - totalAmount).toFixed(8)} OCT</span>
            </div>
            <div className="h-px bg-border my-1.5" />
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="font-mono">{totalCost.toFixed(8)} OCT</span>
            </div>
          </div>
        )}

        {/* Execution Mode */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Execution Mode</Label>
          <Select value={executionMode} onValueChange={(value: 'parallel' | 'sequential') => setExecutionMode(value)} disabled={isSending}>
            <SelectTrigger className="text-sm h-9 ring-inset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="parallel">Parallel (50 tx/batch)</SelectItem>
              <SelectItem value="sequential">Sequential (1 tx at a time)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Send Button */}
        <Button
          onClick={executionMode === 'parallel' ? handleSendAll : handleSendAllSequential}
          disabled={isSending || validRecipients.length === 0 || totalCost > currentBalance}
          className="w-full"
        >
          {isSending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-xs">Sending ({executionMode})...</span>
            </>
          ) : (
            <span className="text-xs">
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

      {/* Separator - Hidden on mobile */}
      <div className={`hidden w-px border-l border-dashed border-border flex-shrink-0 ${
        bothSidebarsOpen 
          ? 'lg:hidden' 
          : oneSidebarOpen 
            ? 'xl:block' 
            : 'lg:block'
      }`} />

      {/* Middle Panel - File Upload & Recipients */}
      <div className={`w-full flex-shrink-0 space-y-4 ${
        bothSidebarsOpen 
          ? 'lg:w-full lg:flex lg:flex-col' 
          : oneSidebarOpen 
            ? 'xl:flex-1 xl:flex xl:flex-col xl:min-w-[320px] xl:max-w-[450px]' 
            : 'lg:flex-1 lg:flex lg:flex-col lg:min-w-[320px] lg:max-w-[500px]'
      }`}>
        {/* Upload Recipients File */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild disabled={!(amountMode === 'same' && !validateAmount(sameAmount))}>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragOver 
                    ? 'border-[#3A4DFF] bg-[#3A4DFF]/5' 
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
                  size="sm"
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
        <div className={`rounded-lg border overflow-hidden ${
          bothSidebarsOpen 
            ? 'lg:flex-1 lg:flex lg:flex-col lg:min-h-0' 
            : oneSidebarOpen 
              ? 'xl:flex-1 xl:flex xl:flex-col xl:min-h-0' 
              : 'xl:flex-1 xl:flex xl:flex-col xl:min-h-0'
        }`}>
          <div className="flex items-center justify-between p-3 bg-muted/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Recipients Preview</span>
              {recipients.length > 0 && (
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-[#3A4DFF] text-xs">
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
          
          <ScrollArea className="h-[200px] xl:flex-1" stabilizeGutter>
            <ScrollAreaContent>
              {recipients.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-muted-foreground">
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
                        ? 'bg-[#3A4DFF]/10 dark:bg-[#3A4DFF]/20' 
                        : 'bg-red-50 dark:bg-red-950/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-muted-foreground w-6 text-right flex-shrink-0">{index + 1}.</span>
                      {recipient.isValid ? (
                        <CheckCircle className="h-3.5 w-3.5 text-[#3A4DFF] flex-shrink-0" />
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
            </ScrollAreaContent>
          </ScrollArea>
        </div>
      </div>

      {/* Separator - Hidden on mobile */}
      <div className={`hidden w-px border-l border-dashed border-border flex-shrink-0 ${
        bothSidebarsOpen 
          ? 'lg:hidden' 
          : oneSidebarOpen 
            ? 'xl:block' 
            : 'lg:block'
      }`} />

      {/* Right Panel - Live Transaction Logs */}
      <div className={`${
        bothSidebarsOpen 
          ? 'lg:flex-1 lg:flex lg:flex-col' 
          : oneSidebarOpen 
            ? 'xl:flex-1 xl:flex xl:flex-col xl:min-w-[280px]' 
            : 'lg:flex-1 lg:flex lg:flex-col lg:min-w-[280px]'
      }`}>
        <div className={`rounded-lg border overflow-hidden ${
          bothSidebarsOpen 
            ? 'lg:flex-1 lg:flex lg:flex-col lg:min-h-0' 
            : oneSidebarOpen 
              ? 'xl:flex-1 xl:flex xl:flex-col xl:min-h-0' 
              : 'lg:flex-1 lg:flex lg:flex-col lg:min-h-0'
        }`}>
          <div className="flex items-center justify-between p-3 bg-muted/30">
            <span className="text-sm font-medium">Transaction Logs</span>
            {txLogs.length > 0 && (
              <div className="flex gap-1">
                {successCount > 0 && (
                  <Badge variant="outline" className="text-[#3A4DFF] text-xs">{successCount}</Badge>
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
          
          <ScrollArea className="h-[200px] xl:flex-1" stabilizeGutter>
            <ScrollAreaContent>
              {txLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Clock className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No transactions yet</p>
                <p className="text-xs">Logs will appear here</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {txLogs.map((log, index) => {
                  // Summary log entry
                  if ('type' in log && log.type === 'summary') {
                    const minutes = Math.floor(log.totalTime / 60);
                    const seconds = (log.totalTime % 60).toFixed(1);
                    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                    return (
                      <div
                        key={index}
                        className="p-3 rounded text-xs bg-blue-50 dark:bg-blue-950/30"
                      >
                        <div className="flex items-center gap-2 font-medium text-blue-700 dark:text-blue-300 mb-2">
                          <Clock className="h-4 w-4" />
                          <span>Bulk Send Complete</span>
                        </div>
                        <div className="space-y-1 text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Success:</span>
                            <span className="text-[#3A4DFF] font-medium">{log.successCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Failed:</span>
                            <span className="text-red-600 font-medium">{log.errorCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total Batches:</span>
                            <span className="font-medium">{log.totalBatches}</span>
                          </div>
                          <div className="border-t border-border my-2" />
                          <div className="flex justify-between">
                            <span>Total Time:</span>
                            <span className="font-mono font-medium">{timeStr}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Batch log entry
                  if ('type' in log && log.type === 'batch') {
                    return (
                      <div
                        key={index}
                        className="p-2 rounded text-xs bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-purple-700 dark:text-purple-300">
                            Batch #{log.batchNumber}
                          </span>
                          <div className="flex gap-2 text-[10px]">
                            <span className="text-muted-foreground">{log.totalInBatch} tx</span>
                            {log.successInBatch > 0 && <span className="text-[#3A4DFF]">✓{log.successInBatch}</span>}
                            {log.failedInBatch > 0 && <span className="text-red-600">✗{log.failedInBatch}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  // Regular transaction log entry
                  const txLog = log as TxLogEntry;
                  return (
                    <div
                      key={index}
                      className={`p-2 rounded text-xs ${
                        txLog.status === 'success' 
                          ? 'bg-[#3A4DFF]/10 dark:bg-[#3A4DFF]/20' 
                          : txLog.status === 'error'
                          ? 'bg-red-50 dark:bg-red-950/30'
                          : txLog.status === 'queued'
                          ? 'bg-gray-50 dark:bg-gray-950/30'
                          : 'bg-yellow-50 dark:bg-yellow-950/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-6 text-right flex-shrink-0">{txLog.txIndex || '-'}.</span>
                        {txLog.status === 'success' && <CheckCircle className="h-3.5 w-3.5 text-[#3A4DFF] flex-shrink-0" />}
                        {txLog.status === 'error' && <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                        {txLog.status === 'pending' && <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin flex-shrink-0" />}
                        {txLog.status === 'retrying' && <Loader2 className="h-3.5 w-3.5 text-orange-500 animate-spin flex-shrink-0" />}
                        {txLog.status === 'queued' && <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                        <span className="font-mono truncate flex-1">
                          {txLog.recipient.slice(0, 8)}...{txLog.recipient.slice(-6)}
                        </span>
                        <span className={`font-mono font-medium ${txLog.status === 'success' ? 'text-red-600' : ''}`}>
                          {txLog.status === 'success' ? '- ' : ''}{txLog.amount} OCT
                        </span>
                      </div>
                      {txLog.hash && (
                        <a 
                          href={`${scannerUrl}${txLog.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-[#3A4DFF] hover:underline mt-1 block truncate"
                        >
                          {txLog.hash.slice(0, 16)}...
                        </a>
                      )}
                      {txLog.error && (
                        <p className="text-[10px] text-red-500 mt-1 truncate">{txLog.error}</p>
                      )}
                    </div>
                  );
                })}
                <div ref={txLogsEndRef} />
              </div>
            )}
            </ScrollAreaContent>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
