import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, Wallet as WalletIcon, Plus, BookUser, Search, Shield, Globe } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance, sendTransaction, createTransaction, invalidateCacheAfterTransaction } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { useAddressBook } from '@/hooks/useAddressBook';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { AddressInput } from './AddressInput';

// Threshold for confirmation dialog (500 OCT)
const LARGE_TRANSACTION_THRESHOLD = 500;

interface SendTransactionProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce?: number;
  onBalanceUpdate: (balance: number) => void;
  onNonceUpdate: (nonce: number) => void;
  onTransactionSuccess: () => void;
  onModalClose?: () => void; // Called when transaction result modal is closed
  isCompact?: boolean;
  onAddToAddressBook?: (address: string) => void; // Callback to add address to address book
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

export function SendTransaction({
  wallet,
  balance,
  nonce: _nonce,
  onBalanceUpdate,
  onNonceUpdate,
  onTransactionSuccess,
  onModalClose,
  isCompact = false,
  onAddToAddressBook
}: SendTransactionProps) {
  const [recipientAddress, setRecipientAddress] = useState('');
  const [addressValidation, setAddressValidation] = useState<{ isValid: boolean; error?: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [ouOption, setOuOption] = useState<string>('auto');
  const [customOu, setCustomOu] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [showAddressBookDropdown, setShowAddressBookDropdown] = useState(false);
  const [addressBookSearch, setAddressBookSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { contacts, walletLabels } = useAddressBook();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowAddressBookDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter contacts and wallets
  const filteredContacts = addressBookSearch
    ? contacts.filter(c => 
        c.label.toLowerCase().includes(addressBookSearch.toLowerCase()) ||
        c.address.toLowerCase().includes(addressBookSearch.toLowerCase())
      )
    : contacts;

  const filteredWallets = addressBookSearch
    ? walletLabels.filter(w =>
        w.address.toLowerCase() !== wallet?.address?.toLowerCase() &&
        (w.name.toLowerCase().includes(addressBookSearch.toLowerCase()) ||
        w.address.toLowerCase().includes(addressBookSearch.toLowerCase()))
      )
    : walletLabels.filter(w => w.address.toLowerCase() !== wallet?.address?.toLowerCase());

  const handleSelectFromAddressBook = (address: string) => {
    setRecipientAddress(address);
    setShowAddressBookDropdown(false);
    setAddressBookSearch('');
  };

  const truncateAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;

  // Check if address is in address book
  const isAddressInBook = (addr: string): boolean => {
    const lowerAddr = addr.toLowerCase();
    return (
      contacts.some((c) => c.address.toLowerCase() === lowerAddr) ||
      walletLabels.some((w) => w.address.toLowerCase() === lowerAddr)
    );
  };

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
        setShowMessage(false);

        // Update nonce
        onNonceUpdate(currentNonce + 1);

        // Update balance after successful transaction
        setTimeout(async () => {
          try {
            // Invalidate cache first
            await invalidateCacheAfterTransaction(wallet.address);
            const updatedBalance = await fetchBalance(wallet.address, true);
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
      <div className="space-y-3" ref={dropdownRef}>
        {/* Recipient Address */}
        <div className="space-y-1 relative">
          <div className="flex items-center justify-between">
            <Label htmlFor="recipient" className="text-xs">Recipient</Label>
            {/* Action buttons - sejajar dengan label Recipient */}
            <div className="flex gap-1">
              {recipientAddress.trim() && 
               /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(recipientAddress.trim()) &&
               recipientAddress.trim().toLowerCase() !== wallet?.address?.toLowerCase() &&
               !isAddressInBook(recipientAddress.trim()) &&
               onAddToAddressBook && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onAddToAddressBook?.(recipientAddress.trim())}
                  className="h-7 w-7 flex-shrink-0 text-[#3A4DFF] hover:text-[#6C63FF] hover:bg-[#6C63FF]/10 border-[#3A4DFF]/30"
                  title="Add to address book"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowAddressBookDropdown(!showAddressBookDropdown)}
                className="h-7 w-7 flex-shrink-0"
                title="Select from contacts"
              >
                <BookUser className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <AddressInput
            id="recipient"
            value={recipientAddress}
            onChange={setRecipientAddress}
            isPopupMode={true}
            isCompact={true}
            hideButtons={true}
            className="text-xs"
            activeWalletAddress={wallet?.address}
            onAddToAddressBook={onAddToAddressBook}
            currentMode="public"
          />
          {recipientAddress.trim() && addressValidation && !addressValidation.isValid && (
            <p className="text-[10px] text-red-600">{addressValidation.error}</p>
          )}
          
          {/* Address Book Dropdown */}
          {showAddressBookDropdown && (
            <div className="absolute top-14 right-0 z-50 w-64 bg-background border rounded-md shadow-lg overflow-hidden">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search contacts..."
                    value={addressBookSearch}
                    onChange={(e) => setAddressBookSearch(e.target.value)}
                    className="h-7 text-xs pl-7"
                    autoFocus
                  />
                </div>
              </div>
              <ScrollArea className="h-[160px]">
                {filteredContacts.length === 0 && filteredWallets.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-xs">
                    {addressBookSearch ? 'No results found' : 'No contacts or wallets'}
                  </div>
                ) : (
                  <div className="p-1">
                    {filteredContacts.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-muted-foreground font-medium text-[10px]">Contacts</div>
                        {filteredContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleSelectFromAddressBook(contact.address)}
                            className="w-full text-left px-2 py-1.5 hover:bg-accent rounded-sm text-xs"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium truncate">{contact.label}</span>
                              {contact.preferredMode === 'private' && <Shield className="h-2.5 w-2.5 text-[#3A4DFF]" />}
                              {contact.preferredMode === 'public' && <Globe className="h-2.5 w-2.5 text-green-600" />}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">{truncateAddress(contact.address)}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {filteredWallets.length > 0 && (
                      <div className={filteredContacts.length > 0 ? 'mt-2 pt-2 border-t' : ''}>
                        <div className="px-2 py-1 text-muted-foreground font-medium text-[10px]">My Wallets</div>
                        {filteredWallets.map((w) => (
                          <button
                            key={w.address}
                            type="button"
                            onClick={() => handleSelectFromAddressBook(w.address)}
                            className="w-full text-left px-2 py-1.5 hover:bg-accent rounded-sm text-xs"
                          >
                            <div className="font-medium truncate">{w.name}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{truncateAddress(w.address)}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="amount" className="text-xs">Amount (OCT)</Label>
            <div className="flex items-center gap-1.5 text-[10px]">
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
                className="text-[#3A4DFF] hover:text-[#6C63FF]/80 font-medium hover:underline"
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
            className="text-xs h-8"
          />
        </div>

        {/* OU (Gas) */}
        <div className="space-y-1">
          <Label className="text-xs">OU (Gas)</Label>
          <Select value={ouOption} onValueChange={setOuOption}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-xs">Auto</SelectItem>
              <SelectItem value="10000" className="text-xs">10,000 OU</SelectItem>
              <SelectItem value="30000" className="text-xs">30,000 OU</SelectItem>
              <SelectItem value="50000" className="text-xs">50,000 OU</SelectItem>
              <SelectItem value="100000" className="text-xs">100,000 OU</SelectItem>
              <SelectItem value="custom" className="text-xs">Custom</SelectItem>
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
              className="h-8 text-xs"
            />
          )}
        </div>

        {/* Message Toggle - Compact */}
        {!showMessage ? (
          <button
            type="button"
            onClick={() => setShowMessage(true)}
            className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground py-1"
          >
            + Add Message
          </button>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="message-compact" className="text-xs">Message</Label>
              <button
                type="button"
                onClick={() => {
                  setShowMessage(false);
                  setMessage('');
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            </div>
            <Textarea
              id="message-compact"
              placeholder="Optional message (max 1024 chars)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1024}
              rows={2}
              className="text-xs min-h-[60px] resize-none"
            />
            <div className="text-[10px] text-muted-foreground text-right">{message.length}/1024</div>
          </div>
        )}

        {/* Fee Summary - Compact */}
        {amount && validateAmount(amount) && (
          <div className="p-2 bg-muted rounded text-[10px] space-y-0.5">
            <div className="flex justify-between">
              <span>Amount:</span>
              <span className="font-mono">{amountNum.toFixed(4)} OCT</span>
            </div>
            <div className="flex justify-between">
              <span>Fee:</span>
              <span className="font-mono">{fee.toFixed(4)} OCT</span>
            </div>
            <div className="h-px bg-border my-0.5" />
            <div className="flex justify-between font-medium">
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
          className="w-full h-9 text-xs"
        >
          {isSending ? (
            <div className="flex items-center gap-2">
              <div className="relative w-3.5 h-3.5">
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
      {/* Recipient Address */}
      <div className="space-y-2">
        <Label htmlFor="recipient">Recipient Address</Label>
        <AddressInput
          id="recipient"
          value={recipientAddress}
          onChange={setRecipientAddress}
          isPopupMode={false}
          activeWalletAddress={wallet?.address}
          onAddToAddressBook={onAddToAddressBook}
          currentMode="public"
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
              className="text-[#3A4DFF] hover:text-[#6C63FF]/80 font-medium hover:underline"
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

      {/* Message Toggle */}
      {!showMessage ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => setShowMessage(true)}
        >
          + Add Message
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="message">Message</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMessage('')}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMessage(false);
                  setMessage('');
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            </div>
          </div>
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
      )}

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
        <div className="p-3 bg-muted  text-sm space-y-1">
          <div className="flex justify-between">
            <span>Amount:</span>
            <span className="font-mono">{amountNum.toFixed(8)} OCT</span>
          </div>
          <div className="flex justify-between">
            <span>Fee:</span>
            <span className="font-mono">{fee.toFixed(8)} OCT</span>
          </div>
          <div className="h-px bg-border my-1" />
          <div className="flex justify-between font-medium">
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
              <div className="bg-muted p-3  space-y-2 font-mono text-sm">
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
