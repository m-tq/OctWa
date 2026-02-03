import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, AlertTriangle, Wallet as WalletIcon, Loader2, Plus, BookUser, Search, Globe } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchEncryptedBalance, createPrivateTransfer, getAddressInfo, invalidateCacheAfterPrivateSend } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { useAddressBook } from '@/hooks/useAddressBook';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { AnimatedIcon } from './AnimatedIcon';
import { AddressInput } from './AddressInput';

interface PrivateTransferProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  encryptedBalance?: any;
  onBalanceUpdate: (newBalance: number) => void;
  onNonceUpdate: (newNonce: number) => void;
  onTransactionSuccess: () => void;
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

export function PrivateTransfer({
  wallet,
  balance: _balance,
  nonce: _nonce,
  encryptedBalance: propEncryptedBalance,
  onBalanceUpdate: _onBalanceUpdate,
  onNonceUpdate: _onNonceUpdate,
  onTransactionSuccess,
  isCompact = false,
  onAddToAddressBook
}: PrivateTransferProps) {
  const [recipientAddress, setRecipientAddress] = useState('');
  const [addressValidation, setAddressValidation] = useState<{ isValid: boolean; error?: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);
  const [localEncryptedBalance, setLocalEncryptedBalance] = useState<any>(null);
  const [recipientInfo, setRecipientInfo] = useState<any>(null);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [showAddressBookDropdown, setShowAddressBookDropdown] = useState(false);
  const [addressBookSearch, setAddressBookSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { contacts, walletLabels } = useAddressBook();

  // Use prop if available, otherwise use local state
  const encryptedBalance = propEncryptedBalance || localEncryptedBalance;

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

  // Only fetch encrypted balance if not provided via props (uses cache)
  useEffect(() => {
    if (wallet && !propEncryptedBalance && !localEncryptedBalance) {
      fetchEncryptedBalance(wallet.address, wallet.privateKey).then(setLocalEncryptedBalance);
    }
  }, [wallet?.address]);

  // Validate recipient address when input changes
  useEffect(() => {
    if (!recipientAddress.trim()) {
      setAddressValidation(null);
      setRecipientInfo(null);
      return;
    }

    const validation = validateRecipientInput(recipientAddress);
    setAddressValidation(validation);
  }, [recipientAddress]);

  // Check recipient info when address is valid
  useEffect(() => {
    const checkRecipient = async () => {
      if (!addressValidation?.isValid || !recipientAddress.trim()) {
        setRecipientInfo(null);
        return;
      }

      const resolvedAddress = recipientAddress.trim();

      // Check if trying to send to self first
      if (resolvedAddress === wallet?.address) {
        setRecipientInfo({ error: "Cannot send to yourself" });
        return;
      }

      setIsCheckingRecipient(true);
      try {
        const info = await getAddressInfo(resolvedAddress);
        setRecipientInfo(info);
      } catch (error) {
        setRecipientInfo({ error: "Failed to check recipient" });
      } finally {
        setIsCheckingRecipient(false);
      }
    };

    const timeoutId = setTimeout(checkRecipient, 300);
    return () => clearTimeout(timeoutId);
  }, [addressValidation, recipientAddress, wallet?.address]);

  const validateAmount = (amountStr: string) => {
    const num = parseFloat(amountStr);
    return !isNaN(num) && num > 0;
  };

  const handleSend = async () => {
    if (!wallet) {
      toast({
        title: "Error",
        description: "No wallet connected",
        variant: "destructive",
      });
      return;
    }

    const finalRecipientAddress = recipientAddress.trim();
    
    if (!addressValidation?.isValid) {
      toast({
        title: "Error",
        description: addressValidation?.error || "Invalid recipient address",
        variant: "destructive",
      });
      return;
    }

    if (!validateAmount(amount)) {
      toast({
        title: "Error",
        description: "Invalid amount",
        variant: "destructive",
      });
      return;
    }

    if (!recipientInfo || recipientInfo.error) {
      toast({
        title: "Error",
        description: recipientInfo?.error || "Invalid recipient",
        variant: "destructive",
      });
      return;
    }

    if (!recipientInfo.has_public_key) {
      toast({
        title: "Error",
        description: "Recipient has no public key. They need to make a transaction first.",
        variant: "destructive",
      });
      return;
    }

    const amountNum = parseFloat(amount);
    if (!encryptedBalance || amountNum > encryptedBalance.encrypted) {
      toast({
        title: "Error",
        description: "Insufficient encrypted balance",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    
    // Show modal with sending state
    setTxModalStatus('sending');
    setTxModalResult({});
    setShowTxModal(true);

    try {
      const transferResult = await createPrivateTransfer(
        wallet.address,
        finalRecipientAddress,
        amountNum,
        wallet.privateKey
      );

      if (transferResult.success) {
        // Invalidate cache after private send
        await invalidateCacheAfterPrivateSend(wallet.address);
        // Update modal to success state
        setTxModalStatus('success');
        setTxModalResult({ hash: transferResult.tx_hash, amount: amountNum.toFixed(8) });

        // Reset form
        setRecipientAddress('');
        setAmount('');
        setRecipientInfo(null);

        // Refresh encrypted balance after transaction
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true).then(setLocalEncryptedBalance);

        onTransactionSuccess();
      } else {
        // Update modal to error state
        setTxModalStatus('error');
        setTxModalResult({ error: transferResult.error || "Unknown error occurred" });
      }
    } catch (error) {
      console.error('Private transfer error:', error);
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

  if (!encryptedBalance || encryptedBalance.encrypted <= 0) {
    return isCompact ? (
      <Alert className="border-[#3A4DFF]/20">
        <AlertDescription className="text-xs">
          No encrypted balance. Encrypt some OCT first.
        </AlertDescription>
      </Alert>
    ) : (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Private Transfer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <AlertDescription>
                No encrypted balance available. You need to encrypt some balance first to make private transfers.
              </AlertDescription>
            </div>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Compact mode for popup
  if (isCompact) {
    return (
      <div className="space-y-3" ref={dropdownRef}>
        {/* Animated Icon - Compact */}
        <AnimatedIcon type="send-private" size="xs" />

        {/* Recipient */}
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
            currentMode="private"
          />
          {recipientAddress.trim() && addressValidation && !addressValidation.isValid && (
            <p className="text-[10px] text-red-600">{addressValidation.error}</p>
          )}
          {recipientInfo && !recipientInfo.has_public_key && (
            <p className="text-[10px] text-red-600">⚠️ Recipient needs a public key</p>
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
                Balance: <span className="font-mono">{encryptedBalance.encrypted.toFixed(4)}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  // Private transfer: use full encrypted balance (no fee needed)
                  const maxAmount = encryptedBalance.encrypted;
                  if (maxAmount > 0) {
                    setAmount(maxAmount.toFixed(8));
                  } else {
                    toast({
                      title: "No Balance",
                      description: "No encrypted balance available",
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
            max={encryptedBalance.encrypted}
            className="text-xs h-8"
          />
        </div>

        <Button
          onClick={handleSend}
          disabled={
            isSending ||
            !addressValidation?.isValid ||
            isCheckingRecipient ||
            !validateAmount(amount) ||
            !recipientInfo ||
            recipientInfo.error ||
            !recipientInfo.has_public_key ||
            parseFloat(amount) > encryptedBalance.encrypted
          }
          className="w-full h-9 text-xs bg-[#3A4DFF] hover:bg-[#6C63FF]/90"
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
            'Send Private'
          )}
        </Button>

        {/* Transaction Modal */}
        <TransactionModal
          open={showTxModal}
          onOpenChange={setShowTxModal}
          status={txModalStatus}
          result={txModalResult}
          type="transfer"
          isPopupMode={isCompact}
        />
      </div>
    );
  }

  // Full mode - Simplified
  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* Animated Icon */}
      <div className="pb-4">
        <AnimatedIcon type="send-private" size="sm" />
      </div>

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
          currentMode="private"
        />
        {recipientAddress.trim() && addressValidation && !addressValidation.isValid && (
          <p className="text-sm text-red-600">{addressValidation.error}</p>
        )}
        {isCheckingRecipient && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking recipient...
          </div>
        )}
        {recipientInfo && !isCheckingRecipient && !recipientInfo.has_public_key && (
          <p className="text-sm text-red-600">⚠️ Recipient needs a public key first</p>
        )}
      </div>

      {/* Amount with Balance and Max */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="amount">Amount (OCT)</Label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Balance: <span className="font-mono">{encryptedBalance.encrypted.toFixed(4)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                // Private transfer: use full encrypted balance (no fee needed)
                const maxAmount = encryptedBalance.encrypted;
                if (maxAmount > 0) {
                  setAmount(maxAmount.toFixed(8));
                } else {
                  toast({
                    title: "No Balance",
                    description: "No encrypted balance available",
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
          max={encryptedBalance.encrypted}
        />
        {amount && validateAmount(amount) && parseFloat(amount) > encryptedBalance.encrypted && (
          <p className="text-sm text-red-600">Amount exceeds available encrypted balance</p>
        )}
      </div>

      <Button 
        onClick={handleSend}
        disabled={
          isSending || 
          !addressValidation?.isValid ||
          isCheckingRecipient ||
          !validateAmount(amount) || 
          !recipientInfo ||
          recipientInfo.error ||
          !recipientInfo.has_public_key ||
          parseFloat(amount) > encryptedBalance.encrypted
        }
        className="w-full bg-[#3A4DFF] hover:bg-[#6C63FF]/90"
        size="lg"
      >
        {isSending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Sending...
          </>
        ) : (
          `Send ${parseFloat(amount || '0').toFixed(8)} OCT`
        )}
      </Button>

      {/* Transaction Modal */}
      <TransactionModal
        open={showTxModal}
        onOpenChange={setShowTxModal}
        status={txModalStatus}
        result={txModalResult}
        type="transfer"
      />
    </div>
  );
}
