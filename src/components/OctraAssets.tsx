/**
 * OctraAssets — OCS01 token list and management.
 *
 * Two render modes:
 *   - inline=true   → embedded inside a tab/panel (no header chrome)
 *   - inline=false  → fullscreen with a back button + title
 *
 * The "Add Token" flow opens a sheet/inline form that lets the user paste a
 * contract address, preview the token's metadata + their balance, and
 * confirm to persist it locally. The "Send" action drops the user into
 * SendTokenPanel (a separate fullscreen view).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus, RefreshCw, Loader2, Search, Send, Copy, Check,
  ChevronLeft, AlertCircle, Coins, Trash2, X,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import {
  OctraToken, fetchTokensByAddress, lookupToken,
  formatTokenAmount, refreshTokenBalance,
} from '../services/octraTokens';
import { SendTokenPanel } from './SendTokenPanel';
import { useToast } from '@/hooks/use-toast';
import { getActiveRPCProvider } from '../utils/rpc';

interface OctraAssetsProps {
  wallet: Wallet;
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
  /** When true, hides the back-button header (used when rendered as a tab). */
  inline?: boolean;
}

// ─── Saved tokens persistence ────────────────────────────────────────────────

function getSavedTokenAddresses(network: string): string[] {
  try {
    const raw = localStorage.getItem(`octra_tokens_${network}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTokenAddress(network: string, address: string) {
  const existing = getSavedTokenAddresses(network);
  if (!existing.includes(address)) {
    existing.push(address);
    localStorage.setItem(`octra_tokens_${network}`, JSON.stringify(existing));
  }
}

function removeTokenAddressLs(network: string, address: string) {
  const existing = getSavedTokenAddresses(network).filter((a) => a !== address);
  localStorage.setItem(`octra_tokens_${network}`, JSON.stringify(existing));
}

function getNetworkId(): string {
  const provider = getActiveRPCProvider();
  return provider?.network ?? 'mainnet';
}

// ─── Add-Token form (shared subcomponent) ────────────────────────────────────

interface AddTokenFormProps {
  walletAddress: string;
  onClose: () => void;
  onAdded: (token: OctraToken) => void;
}

function AddTokenForm({ walletAddress, onClose, onAdded }: AddTokenFormProps) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OctraToken | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleLookup = async () => {
    const a = address.trim();
    if (!a.startsWith('oct') || a.length !== 47) {
      setErr('Enter a valid Octra contract address (oct...)');
      return;
    }
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const token = await lookupToken(a, walletAddress);
      if (!token) setErr('Not a valid OCS01 token, or contract not found.');
      else setResult(token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2.5 p-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Add Token</span>
        <Button variant="ghost" size="sm" onClick={onClose} className="no-focus-ring h-6 w-6 p-0 -mr-1">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-stretch gap-0">
        <Input
          placeholder="oct... contract address"
          value={address}
          onChange={(e) => { setAddress(e.target.value); setErr(null); }}
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          className="font-mono text-xs flex-1 min-w-0"
          style={{
            height: 36,
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            borderRight: 0,
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
          }}
          autoFocus
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleLookup}
          disabled={loading || !address.trim()}
          className="no-focus-ring shrink-0 inline-flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{
            width: 36,
            height: 36,
            border: '1px solid hsl(var(--input))',
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            outline: 'none',
            boxShadow: 'none',
          }}
          title="Lookup"
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />}
        </button>
      </div>

      {err && (
        <div className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      {result && (
        <div className="border border-primary/30 p-2.5 space-y-2 bg-background rounded">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-sm truncate">{result.symbol}</span>
              <span className="text-[11px] text-muted-foreground truncate">{result.name}</span>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {result.decimals} dec
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Your balance</span>
            <span className="font-mono font-medium">
              {formatTokenAmount(result.balance, result.decimals)} {result.symbol}
            </span>
          </div>
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => onAdded(result)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add to my list
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OctraAssets({
  wallet, nonce, onBack, onTransactionSuccess, onNonceUpdate, inline = false,
}: OctraAssetsProps) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<OctraToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddToken, setShowAddToken] = useState(false);
  const [sendingToken, setSendingToken] = useState<OctraToken | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const loadIdRef = useRef(0);

  const loadTokens = useCallback(async () => {
    const myId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTokensByAddress(wallet.address);
      if (myId !== loadIdRef.current) return;

      const savedAddrs = getSavedTokenAddresses(getNetworkId());
      const fetchedAddrs = new Set(result.map((t) => t.address));
      const missing = savedAddrs.filter((a) => !fetchedAddrs.has(a));

      if (missing.length > 0) {
        const lookups = await Promise.allSettled(
          missing.map((addr) => lookupToken(addr, wallet.address)),
        );
        for (const r of lookups) {
          if (r.status === 'fulfilled' && r.value) result.push(r.value);
        }
      }

      if (myId !== loadIdRef.current) return;
      setTokens(result);
    } catch (e) {
      if (myId !== loadIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (myId === loadIdRef.current) setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  const handleAdded = (token: OctraToken) => {
    saveTokenAddress(getNetworkId(), token.address);
    setTokens((prev) => {
      if (prev.find((t) => t.address === token.address)) return prev;
      return [...prev, token];
    });
    setShowAddToken(false);
    toast({ title: 'Token added', description: `${token.symbol} added to your list` });
  };

  const handleRemoveToken = (address: string) => {
    removeTokenAddressLs(getNetworkId(), address);
    setTokens((prev) => prev.filter((t) => t.address !== address));
  };

  const handleCopyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  };

  // ─── Send Token sub-panel ──────────────────────────────────────────────────

  if (sendingToken) {
    return (
      <SendTokenPanel
        wallet={wallet}
        token={sendingToken}
        nonce={nonce}
        onBack={() => setSendingToken(null)}
        onTransactionSuccess={(tx) => {
          onTransactionSuccess(tx);
          refreshTokenBalance(sendingToken.address, wallet.address).then((newBal) => {
            setTokens((prev) =>
              prev.map((t) => (t.address === sendingToken.address ? { ...t, balance: newBal } : t)),
            );
          });
          setSendingToken(null);
        }}
        onNonceUpdate={onNonceUpdate}
      />
    );
  }

  // ─── Toolbar ───────────────────────────────────────────────────────────────
  // Single compact toolbar: token count on the left, refresh + add on the right.
  // No surrounding border in inline mode (the parent tab surface owns that).

  const Toolbar = (
    <div className={`flex items-center justify-between px-3 py-1.5 ${inline ? '' : 'border-b border-border'}`}>
      <span className="text-[11px] text-muted-foreground">
        {loading && tokens.length === 0
          ? 'Loading...'
          : tokens.length === 0
          ? 'No tokens'
          : `${tokens.length} token${tokens.length === 1 ? '' : 's'}`}
      </span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={loadTokens}
          disabled={loading}
          className="no-focus-ring h-7 w-7 p-0"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAddToken((v) => !v)}
          className={`no-focus-ring h-7 px-2 gap-1 text-[11px] ${showAddToken ? 'text-primary' : ''}`}
          title="Add Token"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );

  // ─── Token list body ───────────────────────────────────────────────────────

  const TokenList = (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-3 space-y-2">
        {loading && tokens.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tokens...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-8 text-xs text-destructive justify-center">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Coins className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">No OCS01 tokens found</p>
            {!showAddToken && (
              <Button variant="outline" size="sm" onClick={() => setShowAddToken(true)} className="h-8 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Token
              </Button>
            )}
          </div>
        ) : (
          tokens.map((token) => {
            const balanceFormatted = formatTokenAmount(token.balance, token.decimals);
            const isZero = token.balance === '0';
            const isCopied = copiedAddr === token.address;
            return (
              <div
                key={token.address}
                className="border border-border rounded p-2.5 space-y-1.5 hover:border-primary/30 transition-colors bg-background"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-semibold text-sm truncate">{token.symbol}</span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {token.name}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-sm shrink-0 ${
                      isZero ? 'text-muted-foreground/60' : 'font-medium'
                    }`}
                  >
                    {balanceFormatted}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleCopyAddress(token.address)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono hover:text-primary transition-colors min-w-0"
                  >
                    <span className="truncate">
                      {token.address.slice(0, 10)}…{token.address.slice(-4)}
                    </span>
                    {isCopied
                      ? <Check className="h-2.5 w-2.5 text-primary shrink-0" />
                      : <Copy className="h-2.5 w-2.5 shrink-0" />}
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="no-focus-ring h-6 px-2 text-[10px] gap-1"
                      onClick={() => setSendingToken(token)}
                      disabled={isZero}
                    >
                      <Send className="h-3 w-3" /> Send
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="no-focus-ring h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveToken(token.address)}
                      title="Remove from list"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </ScrollArea>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (inline) {
    return (
      <div className="flex flex-col h-full">
        {Toolbar}
        {showAddToken && (
          <AddTokenForm
            walletAddress={wallet.address}
            onClose={() => setShowAddToken(false)}
            onAdded={handleAdded}
          />
        )}
        {TokenList}
      </div>
    );
  }

  // Fullscreen mode: own header with back button + title
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Coins className="h-5 w-5" />
          <h2 className="font-semibold text-sm">Octra Assets</h2>
        </div>
      </div>
      {Toolbar}
      {showAddToken && (
        <AddTokenForm
          walletAddress={wallet.address}
          onClose={() => setShowAddToken(false)}
          onAdded={handleAdded}
        />
      )}
      {TokenList}
    </div>
  );
}
