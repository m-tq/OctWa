/**
 * SendTokenPanel — Send OCS01 tokens to another address.
 *
 * Uses op_type="call", method="transfer", params=[to, amount_raw].
 * The transaction is signed and submitted via the same createTransaction +
 * sendTransaction flow as native OCT sends.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ChevronLeft, Send, Loader2, AlertTriangle, Check,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { OctraToken, formatTokenAmount, toTokenRawUnits } from '../services/octraTokens';
import { createTransaction, sendTransaction, invalidateCacheAfterTransaction, fetchRecommendedFee } from '../utils/api';
import { useToast } from '@/hooks/use-toast';

interface SendTokenPanelProps {
  wallet: Wallet;
  token: OctraToken;
  nonce: number;
  onBack: () => void;
  onTransactionSuccess: (tx?: {
    hash: string;
    from: string;
    to: string;
    amount: number;
    status: 'confirmed' | 'pending' | 'failed';
    op_type?: string;
  }) => void;
  onNonceUpdate: (nonce: number) => void;
}

export function SendTokenPanel({
  wallet, token, nonce, onBack, onTransactionSuccess, onNonceUpdate,
}: SendTokenPanelProps) {
  const { toast } = useToast();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const maxBalance = formatTokenAmount(token.balance, token.decimals);
  const rawBalance = BigInt(token.balance || '0');

  const validate = (): string | null => {
    if (!recipient.trim()) return 'Recipient address is required';
    if (!recipient.trim().startsWith('oct') || recipient.trim().length !== 47) {
      return 'Invalid Octra address';
    }
    if (!amount || parseFloat(amount) <= 0) return 'Amount must be greater than 0';
    const rawAmount = BigInt(toTokenRawUnits(amount, token.decimals));
    if (rawAmount > rawBalance) return 'Insufficient token balance';
    return null;
  };

  const handleSend = async () => {
    const err = validate();
    if (err) { setError(err); return; }

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const rawAmount = toTokenRawUnits(amount, token.decimals);

      // Get recommended fee for contract call
      let fee = 1000;
      try {
        fee = await fetchRecommendedFee('call');
      } catch { /* use default */ }

      // Build contract call transaction
      // createTransaction(sender, recipient, amount, nonce, privateKey, publicKey, message?, customOu?, opType?, encryptedData?)
      const tx = createTransaction(
        wallet.address,
        token.address,  // to = token contract
        0,              // amount = 0 OCT (no native transfer)
        nonce + 1,
        wallet.privateKey,
        wallet.publicKey || '',
        JSON.stringify([recipient.trim(), parseInt(rawAmount, 10)]), // message = params
        fee,            // customOu
        'call',         // opType
        'transfer',     // encryptedData = method name
      );

      const result = await sendTransaction(tx);

      if (result.success && result.hash) {
        const newNonce = nonce + 1;
        onNonceUpdate(newNonce);
        invalidateCacheAfterTransaction(wallet.address);

        setSuccess(`Sent ${amount} ${token.symbol} → ${recipient.slice(0, 12)}...`);
        toast({
          title: 'Token transfer submitted',
          description: `${amount} ${token.symbol} sent`,
        });

        onTransactionSuccess({
          hash: result.hash,
          from: wallet.address,
          to: recipient.trim(),
          amount: parseFloat(amount),
          status: 'pending',
          op_type: 'call',
        });
      } else {
        setError(result.reason || result.error || 'Transaction rejected');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const handleMax = () => {
    setAmount(maxBalance);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          <h2 className="font-semibold text-sm">Send {token.symbol}</h2>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto p-4">
        <div className="w-full max-w-sm space-y-4">
          {/* Token info */}
          <div className="flex items-center justify-between p-3 border bg-muted/30">
            <div>
              <span className="font-medium text-sm">{token.symbol}</span>
              <span className="text-xs text-muted-foreground ml-2">{token.name}</span>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm">{maxBalance}</div>
              <div className="text-[10px] text-muted-foreground">available</div>
            </div>
          </div>

          {/* Recipient */}
          <div className="space-y-1.5">
            <Label className="text-xs">Recipient</Label>
            <Input
              placeholder="oct..."
              value={recipient}
              onChange={e => { setRecipient(e.target.value); setError(null); }}
              className="font-mono text-xs"
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Amount</Label>
              <button
                onClick={handleMax}
                className="text-[10px] text-primary hover:underline"
              >
                MAX
              </button>
            </div>
            <Input
              type="number"
              placeholder="0"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(null); }}
              className="font-mono"
              step="any"
              min="0"
            />
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {/* Success */}
          {success && (
            <Alert className="py-2 border-primary/30">
              <Check className="h-3.5 w-3.5 text-primary" />
              <AlertDescription className="text-xs text-primary">{success}</AlertDescription>
            </Alert>
          )}

          {/* Submit */}
          <Button
            className="w-full"
            onClick={handleSend}
            disabled={sending || !recipient || !amount}
          >
            {sending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Send {token.symbol}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
