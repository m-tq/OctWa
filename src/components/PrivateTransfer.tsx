import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, AlertTriangle, Wallet as WalletIcon, CheckCircle, Loader2 } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchEncryptedBalance, createPrivateTransfer, getAddressInfo } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import { TransactionModal, TransactionStatus, TransactionResult } from './TransactionModal';

interface PrivateTransferProps {
  wallet: Wallet | null;
  balance: number | null;
  nonce: number;
  encryptedBalance?: any;
  onBalanceUpdate: (newBalance: number) => void;
  onNonceUpdate: (newNonce: number) => void;
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

export function PrivateTransfer({
  wallet,
  balance,
  nonce,
  encryptedBalance: propEncryptedBalance,
  onBalanceUpdate,
  onNonceUpdate,
  onTransactionSuccess,
  isCompact = false
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
  const { toast } = useToast();

  // Use prop if available, otherwise use local state
  const encryptedBalance = propEncryptedBalance || localEncryptedBalance;

  // Only fetch encrypted balance if not provided via props
  useEffect(() => {
    if (wallet && !propEncryptedBalance) {
      fetchEncryptedBalance(wallet.address, wallet.privateKey).then(setLocalEncryptedBalance);
    }
  }, [wallet, propEncryptedBalance]);

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
        // Update modal to success state
        setTxModalStatus('success');
        setTxModalResult({ hash: transferResult.tx_hash, amount: amountNum.toFixed(8) });

        // Reset form
        setRecipientAddress('');
        setAmount('');
        setRecipientInfo(null);

        // Refresh encrypted balance after transaction
        fetchEncryptedBalance(wallet.address, wallet.privateKey).then(setLocalEncryptedBalance);

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
      <Alert className="border-[#0000db]/20">
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
      <div className="space-y-3">
        {/* Private Balance - Compact */}
        <div className="p-2 bg-[#0000db]/5 border border-[#0000db]/20 rounded text-xs">
          <div className="flex justify-between items-center">
            <span>Private Balance</span>
            <span className="font-mono font-bold text-[#0000db]">
              {encryptedBalance.encrypted.toFixed(4)} OCT
            </span>
          </div>
        </div>

        {/* Recipient */}
        <div className="space-y-1">
          <Label htmlFor="recipient" className="text-xs">Recipient</Label>
          <Input
            id="recipient"
            placeholder="oct..."
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            className="font-mono text-xs h-8"
          />
          {recipientAddress.trim() && addressValidation && !addressValidation.isValid && (
            <p className="text-[10px] text-red-600">{addressValidation.error}</p>
          )}
          {recipientInfo && !recipientInfo.has_public_key && (
            <p className="text-[10px] text-red-600">⚠️ Recipient needs a public key</p>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <Label htmlFor="amount" className="text-xs">Amount (OCT)</Label>
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
          className="w-full h-8 text-xs bg-[#0000db] hover:bg-[#0000db]/90"
          size="sm"
        >
          {isSending ? 'Sending...' : 'Send Private'}
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

  // Full mode
  return (
    <Card className="border-[#0000db]/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#0000db]">
          <Shield className="h-5 w-5" />
          Private Transfer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert className="border-[#0000db]/20 bg-[#0000db]/5">
          <div className="flex items-start space-x-3">
            <Shield className="h-4 w-4 mt-0.5 flex-shrink-0 text-[#0000db]" />
            <AlertDescription>
              Private transfers use your encrypted balance and are completely anonymous. The recipient can claim the transfer in the next epoch.
            </AlertDescription>
          </div>
        </Alert>

        {/* Encrypted Balance Display */}
        <div className="p-3 bg-[#0000db]/5 border border-[#0000db]/20 rounded-md">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Available Private Balance</span>
            <span className="font-mono text-lg font-bold text-[#0000db]">
              {encryptedBalance.encrypted.toFixed(8)} OCT
            </span>
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
          
          {/* Recipient Status */}
          {isCheckingRecipient && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking recipient...
            </div>
          )}
          
          {/* Address Validation Status */}
          {recipientAddress.trim() && addressValidation && !isCheckingRecipient && (
            <div className="space-y-2">
              {addressValidation.isValid ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">Valid Octra address</span>
                </div>
              ) : (
                <div className="text-sm text-red-600">{addressValidation.error}</div>
              )}
              
              {recipientInfo && !recipientInfo.error && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Balance: {recipientInfo.balance || '0'} OCT
                  </div>
                  {!recipientInfo.has_public_key && (
                    <div className="text-sm text-red-600">
                      ⚠️ Recipient has no public key. They need to make a transaction first.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {recipientInfo && !isCheckingRecipient && recipientInfo.error && (
            <div className="text-sm text-red-600">{recipientInfo.error}</div>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label htmlFor="amount">Amount (OCT)</Label>
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
          className="w-full bg-[#0000db] hover:bg-[#0000db]/90"
          size="lg"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sending Private Transfer...
            </>
          ) : (
            <>
              <Shield className="h-4 w-4 mr-2" />
              Send Private Transfer
            </>
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
      </CardContent>
    </Card>
  );
}