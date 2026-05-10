import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, AlertTriangle, Wallet as WalletIcon, Loader2, Plus, BookUser, Search, Globe } from 'lucide-react';
import { Wallet, EncryptedBalanceResponse } from '../types/wallet';
import { fetchEncryptedBalance, getAddressInfo, getViewPubkey, invalidateCacheAfterPrivateSend, fetchBalance, sendTransaction, fetchRecommendedFee } from '../utils/api';
import { getPvacWasm } from '@/lib/pvac/wasm-loader';
import { useToast } from '@/hooks/use-toast';
import { useAddressBook } from '@/hooks/useAddressBook';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';
import { AnimatedIcon } from './AnimatedIcon';
import { AddressInput } from './AddressInput';
import { PvacProgressBar } from './PvacProgressBar';
import { PvacOperationModal } from './PvacOperationModal';
import { FeeSelector, FeeOption, getEffectiveFee } from './FeeSelector';
import { usePvacOperation } from '@/hooks/usePvacOperation';
import { RangeServerSetup } from './RangeServerSetup';
import { isRangeServerAvailable } from '@/services/rangeProofServer';
import { isOctAddress, isValidLabel, normalizeLabel } from '@/integrations/ons';

interface PrivateTransferProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  encryptedBalance?: EncryptedBalanceResponse | null;
  onBalanceUpdate: (newBalance: number) => void;
  onNonceUpdate: (newNonce: number) => void;
  onTransactionSuccess: (newTx?: {
    hash: string; from: string; to: string; amount: number;
    status: 'confirmed' | 'pending' | 'failed'; finality?: string;
    op_type?: string;
    ou?: string | number;
  }) => void;
  /** Called with fresh encrypted balance right after stealth send completes. */
  onEncryptedBalanceUpdate?: (enc: EncryptedBalanceResponse | null) => void;
  isCompact?: boolean;
  onAddToAddressBook?: (address: string) => void;
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

  // Accept a well-formed ONS label — the resolver chip will swap it with the
  // actual address before submission.
  if (isValidOnsLabel(trimmedInput)) {
    return { isValid: true };
  }

  return {
    isValid: false,
    error: 'Enter a valid Octra address (oct...) or an ONS name (alice.oct).',
  };
}

function isValidOnsLabel(raw: string): boolean {
  const label = raw.trim().toLowerCase().replace(/\.oct$/i, '');
  if (label.length < 3 || label.length > 63) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(label);
}

export function PrivateTransfer({
  wallet,
  balance: _balance,
  nonce: _nonce,
  encryptedBalance: propEncryptedBalance,
  onBalanceUpdate: _onBalanceUpdate,
  onNonceUpdate: _onNonceUpdate,
  onTransactionSuccess,
  onEncryptedBalanceUpdate,
  isCompact = false,
  onAddToAddressBook
}: PrivateTransferProps) {
  const [recipientAddress, setRecipientAddress] = useState('');
  const [addressValidation, setAddressValidation] = useState<{ isValid: boolean; error?: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);
  const [localEncryptedBalance, setLocalEncryptedBalance] = useState<EncryptedBalanceResponse | null>(null);
  const [recipientInfo, setRecipientInfo] = useState<{ has_public_key?: boolean; error?: string } | null>(null);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalStatus, setTxModalStatus] = useState<TransactionStatus>('idle');
  const [txModalResult, setTxModalResult] = useState<TransactionResult>({});
  const [txContext, setTxContext] = useState<{ from: string; to: string } | null>(null);
  const [showPvacModal, setShowPvacModal] = useState(false);
  const [showAddressBookDropdown, setShowAddressBookDropdown] = useState(false);
  const [addressBookSearch, setAddressBookSearch] = useState('');
  const [customFee, setCustomFee] = useState('');
  const [feeOption, setFeeOption] = useState<FeeOption>('recommended');
  const [recommendedFee, setRecommendedFee] = useState(5000);
  const [rangeServerReady, setRangeServerReady] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef(false);
  const { toast } = useToast();
  const { contacts, walletLabels } = useAddressBook();
  const pvacOp = usePvacOperation();
  
  // Fetch dynamic stealth fee on mount + pre-warm WASM so first send is instant
  useEffect(() => {
    fetchRecommendedFee('stealth').then(fee => setRecommendedFee(fee)).catch(() => {});
    isRangeServerAvailable().then(setRangeServerReady);
    // Pre-warm: load WASM module in background so keygen is cached before user clicks Send
    if (wallet?.privateKey) {
      getPvacWasm(wallet.privateKey).catch(() => { /* best-effort */ });
    }
  }, [wallet?.privateKey]);
  
  const handleTxModalOpenChange = (open: boolean) => {
    setShowTxModal(open);
    if (!open) {
      setTxModalStatus('idle');
    }
  };

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

  // Hide the external contacts button once the user has committed to a
  // recipient (valid oct address or a well-formed ONS label). The clear X
  // inside the input or resolved card is enough to reset the field.
  const recipientHasCommitted = (() => {
    const v = recipientAddress.trim();
    if (!v) return false;
    if (isOctAddress(v)) return true;
    return isValidLabel(normalizeLabel(v));
  })();

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
    // Hard guard — prevent double-submit even if React re-renders between clicks
    if (isSendingRef.current) return;
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

    // Inputs now accept ONS labels (the resolver card auto-swaps them for the
    // oct address). Block submission if the label hasn't finished resolving.
    if (!isOctraAddress(finalRecipientAddress)) {
      toast({
        title: "Still resolving",
        description: `"${finalRecipientAddress}" is a name — wait for it to resolve or clear and paste the address.`,
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
    isSendingRef.current = true;

    setTxContext({ from: wallet.address, to: finalRecipientAddress });
    setShowPvacModal(true);
    pvacOp.reset();

    try {
      await handleSendWithBrowser(finalRecipientAddress, amountNum);
    } catch (error) {
      console.error('Private transfer error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setTxModalStatus('error');
      setTxModalResult({ error: errorMsg });
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  };

  const handleSendWithBrowser = async (toAddress: string, amountNum: number) => {
    const recipientViewPubkey = await getViewPubkey(toAddress);
    if (!recipientViewPubkey) {
      throw new Error('Recipient has no view pubkey -- they must register PVAC first');
    }

    const amountRaw = BigInt(Math.floor(amountNum * 1_000_000));

    // Force-refresh both nonce AND encrypted balance cipher before stealth send.
    // After wallet switch, the UI may still show stale cipher/balance from the
    // previous wallet. Always fetch fresh data from the node.
    const [freshBalanceData, freshEncData] = await Promise.all([
      fetchBalance(wallet!.address, true),
      fetchEncryptedBalance(wallet!.address, wallet!.privateKey, true),
    ]);
    const nonce = freshBalanceData.nonce;

    // Use fresh cipher from node — never trust the prop which may be stale
    const freshCipher = freshEncData?.cipher;
    console.log('[StealthSend] address:', wallet!.address,
      'freshEncrypted:', freshEncData?.encrypted,
      'cipherLen:', freshCipher?.length,
      'amount:', amountNum);

    if (!freshCipher || freshCipher === '0' || !freshCipher.startsWith('hfhe_v1|')) {
      throw new Error('No valid encrypted balance found for this wallet. Please encrypt some balance first.');
    }

    const freshEncryptedBalance = freshEncData?.encrypted ?? 0;
    if (amountNum > freshEncryptedBalance) {
      throw new Error(`Insufficient encrypted balance: have ${freshEncryptedBalance.toFixed(6)} OCT, need ${amountNum.toFixed(6)} OCT`);
    }

    const ou = String(getEffectiveFee(recommendedFee, feeOption, customFee));

    const result = await pvacOp.runWorker<{ tx: import('../types/wallet').Transaction }>(
      'stealthSend',
      {
        privateKey:          wallet!.privateKey,
        publicKey:           wallet!.publicKey || '',
        address:             wallet!.address,
        toAddress,
        amountRaw:           amountRaw.toString(),
        currentCipher:       freshCipher,
        recipientViewPubkey,
        nonce:               nonce + 1,
        ou,
      },
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Stealth send failed');
    }

    // Show "retrieving result" immediately while sendTransaction runs.
    setShowPvacModal(false);
    setShowTxModal(true);
    setTxModalStatus('retrieving');

    const submitResult = await sendTransaction(
      result.data.tx as import('../types/wallet').Transaction
    );
    if (!submitResult.success) {
      throw new Error(submitResult.error || 'Failed to submit transaction');
    }

    const txHash = submitResult.hash || 'pending';
    setTxModalStatus('success');
    setTxModalResult({
      hash: txHash,
      amount: amountNum.toFixed(8),
      finality: 'pending',
    });

    // Add to history immediately as pending — silentRefreshAfterTx will upgrade to confirmed
    onTransactionSuccess({
      hash: txHash,
      from: wallet!.address,
      to: 'stealth',
      amount: amountNum,
      status: 'pending',
      op_type: 'stealth',
      ou: getEffectiveFee(recommendedFee, feeOption, customFee),
    });

    toast({ title: "Transfer Successful", description: `Sent ${amountNum} OCT privately` });
    setRecipientAddress('');
    setAmount('');
    setRecipientInfo(null);

    // Refresh balance in background -- does not block the success modal.
    invalidateCacheAfterPrivateSend(wallet!.address)
      .then(() => fetchEncryptedBalance(wallet!.address, wallet!.privateKey, true))
      .then((freshEncrypted) => {
        setLocalEncryptedBalance(freshEncrypted);
        // Propagate fresh encrypted balance to WalletDashboard for immediate cache update
        if (onEncryptedBalanceUpdate) onEncryptedBalanceUpdate(freshEncrypted);
      })
      .catch(() => { /* best-effort */ });
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

  if (!showTxModal && (!encryptedBalance || encryptedBalance.encrypted <= 0)) {
    return isCompact ? (
      <Alert className="border-[#3B567F]/20">
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
        {showPvacModal && (
          <PvacOperationModal
            opType="stealth_send"
            {...pvacOp}
            onDismiss={() => { setShowPvacModal(false); pvacOp.reset(); }}
          />
        )}
        {showTxModal ? (
          <TransactionModal
            open={showTxModal}
            onOpenChange={handleTxModalOpenChange}
            status={txModalStatus}
            result={txModalResult}
            type="transfer"
            isPopupMode={isCompact}
            fromAddress={txContext?.from}
            toAddress={txContext?.to}
          />
        ) : (
          <>
            <AnimatedIcon type="send-private" size="xs" />
            <div className="space-y-1 relative">
              <div className="flex items-center justify-between">
                <Label htmlFor="recipient" className="text-xs">Recipient</Label>
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
                      className="h-7 w-7 flex-shrink-0 text-[#3B567F] hover:text-[#6C63FF] hover:bg-[#6C63FF]/10 border-[#3B567F]/30"
                      title="Add to address book"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                  {!recipientHasCommitted && (
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
                  )}
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
                                  {contact.preferredMode === 'private' && <Shield className="h-2.5 w-2.5 text-[#3B567F]" />}
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

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="amount" className="text-xs">Amount (OCT)</Label>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-muted-foreground">
                    Balance: <span className="font-mono">{(encryptedBalance?.encrypted ?? 0).toFixed(4)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const maxAmount = (encryptedBalance?.encrypted ?? 0);
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
                    className="text-[#00E5C0] hover:text-[#00E5C0]/80 font-medium hover:underline"
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
                max={(encryptedBalance?.encrypted ?? 0)}
                className="text-xs h-8"
              />
            </div>

            {/* Range server setup — compact */}
            {!rangeServerReady && (
              <RangeServerSetup
                onAvailable={() => setRangeServerReady(true)}
                compact
              />
            )}

            {/* Custom Fee - Compact Mode */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Network Fee</Label>
              <FeeSelector
                recommendedFee={recommendedFee}
                feeOption={feeOption}
                customFee={customFee}
                onFeeOptionChange={setFeeOption}
                onCustomFeeChange={setCustomFee}
                disabled={isSending}
                isPopupMode
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
                !!recipientInfo.error ||
                !recipientInfo.has_public_key ||
                parseFloat(amount) > (encryptedBalance?.encrypted ?? 0) ||
                !rangeServerReady
              }
              className="w-full h-9 text-xs bg-[#00E5C0] hover:bg-[#00E5C0]/80"
            >
              {isSending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Sending...</span>
                </div>
              ) : (
                <>Send Private</>
              )}
            </Button>
          </>
        )}
      </div>
    );
  }

  // Full mode - Simplified
  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {showPvacModal && (
        <PvacOperationModal
          opType="stealth_send"
          {...pvacOp}
          onDismiss={() => { setShowPvacModal(false); pvacOp.reset(); }}
        />
      )}
      {showTxModal ? (
        <TransactionModal
          open={showTxModal}
          onOpenChange={handleTxModalOpenChange}
          status={txModalStatus}
          result={txModalResult}
          type="transfer"
          fromAddress={txContext?.from}
          toAddress={txContext?.to}
        />
      ) : (
        <>
          <div className="pb-4">
            <AnimatedIcon type="send-private" size="sm" />
          </div>
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount (OCT)</Label>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Balance: <span className="font-mono">{(encryptedBalance?.encrypted ?? 0).toFixed(4)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const maxAmount = (encryptedBalance?.encrypted ?? 0);
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
                  className="text-[#00E5C0] hover:text-[#00E5C0]/80 font-medium hover:underline"
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
              max={(encryptedBalance?.encrypted ?? 0)}
            />
            {amount && validateAmount(amount) && parseFloat(amount) > (encryptedBalance?.encrypted ?? 0) && (
              <p className="text-sm text-red-600">Amount exceeds available encrypted balance</p>
            )}
          </div>

          {/* Range server setup — full mode */}
          {!rangeServerReady && (
            <RangeServerSetup onAvailable={() => setRangeServerReady(true)} />
          )}

          {/* Custom Fee - Full Mode */}
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Network Fee</Label>
            <FeeSelector
              recommendedFee={recommendedFee}
              feeOption={feeOption}
              customFee={customFee}
              onFeeOptionChange={setFeeOption}
              onCustomFeeChange={setCustomFee}
              disabled={isSending}
            />
          </div>

          {/* Progress bar during browser-based stealth send */}
          {pvacOp.isRunning && (
            <PvacProgressBar progress={pvacOp.progress} isRunning={pvacOp.isRunning} />
          )}

          <Button 
            onClick={handleSend}
            disabled={
              isSending || 
              !addressValidation?.isValid ||
              isCheckingRecipient ||
              !validateAmount(amount) || 
              !recipientInfo ||
              !!recipientInfo.error ||
              !recipientInfo.has_public_key ||
              parseFloat(amount) > (encryptedBalance?.encrypted ?? 0) ||
              !rangeServerReady
            }
            className="w-full bg-[#00E5C0] hover:bg-[#00E5C0]/80"
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
        </>
      )}
    </div>
  );
}
