// Unified handler for dApp requests (RFC-O-1).
//
// Listens for pending request keys written by background.js and renders
// the appropriate approval UI. Sends results back to the background as
// typed messages (CONNECTION_RESULT, SIGN_MESSAGE_RESULT, TX_RESULT, etc.).

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Check,
  X,
  AlertTriangle,
  Globe,
  Send,
  FileText,
  Lock,
  Unlock,
  Eye,
  Edit,
  Gift,
  ChevronRight,
  Wallet as WalletIcon,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { useAddressBook } from '@/hooks/useAddressBook';
import {
  createTransaction,
  sendTransaction,
  fetchBalance,
  fetchRecommendedFee,
  fetchEncryptedBalance,
  getViewPubkey,
  ouToOct,
} from '../utils/api';
import { scanStealthOutputs } from '@/services/stealthScanService';
import { logger } from '@/utils/logger';
import nacl from 'tweetnacl';

// =============================================================================
// Request Types (RFC-O-1)
// =============================================================================

interface ConnectRequest {
  pendingKey: string;
  appOrigin: string;
  appName?: string;
  permissions: string[];
  networkId?: string;
  timestamp: number;
}

interface SignMessageRequest {
  pendingKey: string;
  appOrigin: string;
  message: string;
  address?: string;
  timestamp: number;
}

interface TxRequest {
  pendingKey: string;
  appOrigin: string;
  to: string;
  amount: string;
  fee?: string;
  message?: string;
  timestamp: number;
}

interface SignTxRequest {
  pendingKey: string;
  appOrigin: string;
  to: string;
  amount: string;
  fee: string;
  nonce?: string;
  message?: string;
  timestamp: number;
}

interface ContractTxRequest {
  pendingKey: string;
  appOrigin: string;
  address: string;
  method: string;
  params: unknown[];
  amount: string;
  fee?: string;
  timestamp: number;
}

interface EncryptDecryptRequest {
  pendingKey: string;
  appOrigin: string;
  amount: string;
  fee?: string;
  timestamp: number;
}

interface StealthRequest {
  pendingKey: string;
  appOrigin: string;
  to: string;
  amount: string;
  fee?: string;
  timestamp: number;
}

interface ClaimRequest {
  pendingKey: string;
  appOrigin: string;
  outputId: string;
  fee?: string;
  timestamp: number;
}

interface SensitiveWriteRequest {
  pendingKey: string;
  appOrigin: string;
  method: string;
  params: unknown[];
  timestamp: number;
}

// ── EVM Request Types ─────────────────────────────────────────────────────────

interface EvmTxRequest {
  pendingKey: string;
  appOrigin: string;
  to: string;
  value: string;
  data?: string;
  gasLimit?: string;
  chainId: number;
  networkName: string;
  symbol: string;
  timestamp: number;
}

interface EvmSignMessageRequest {
  pendingKey: string;
  appOrigin: string;
  message: string;
  timestamp: number;
}

interface EvmTypedDataRequest {
  pendingKey: string;
  appOrigin: string;
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  value: Record<string, unknown>;
  primaryType?: string;
  timestamp: number;
}

interface EvmTokenTxRequest {
  pendingKey: string;
  appOrigin: string;
  token: string;
  to: string;
  amount: string;
  chainId: number;
  networkName: string;
  symbol: string;
  timestamp: number;
}

interface EvmApproveRequest {
  pendingKey: string;
  appOrigin: string;
  token: string;
  spender: string;
  amount: string;
  chainId: number;
  networkName: string;
  timestamp: number;
}

interface EvmSwitchChainRequest {
  pendingKey: string;
  appOrigin: string;
  fromChainId: number;
  fromName: string;
  toChainId: number;
  toName: string;
  toSymbol: string;
  timestamp: number;
}

interface SwitchNetworkRequest {
  pendingKey: string;
  appOrigin: string;
  fromNetworkId: string;
  fromName: string;
  toNetworkId: string;
  toName: string;
  timestamp: number;
}

type ActiveRequest =
  | { kind: 'connect'; data: ConnectRequest }
  | { kind: 'signMessage'; data: SignMessageRequest }
  | { kind: 'tx'; data: TxRequest }
  | { kind: 'signTx'; data: SignTxRequest }
  | { kind: 'contract'; data: ContractTxRequest }
  | { kind: 'encrypt'; data: EncryptDecryptRequest }
  | { kind: 'decrypt'; data: EncryptDecryptRequest }
  | { kind: 'stealth'; data: StealthRequest }
  | { kind: 'claim'; data: ClaimRequest }
  | { kind: 'write'; data: SensitiveWriteRequest }
  | { kind: 'evmTx'; data: EvmTxRequest }
  | { kind: 'evmSign'; data: EvmSignMessageRequest }
  | { kind: 'evmTypedData'; data: EvmTypedDataRequest }
  | { kind: 'evmToken'; data: EvmTokenTxRequest }
  | { kind: 'evmApprove'; data: EvmApproveRequest }
  | { kind: 'evmSwitchChain'; data: EvmSwitchChainRequest }
  | { kind: 'switchNetwork'; data: SwitchNetworkRequest };

interface DAppRequestHandlerProps {
  wallets: Wallet[];
}

// =============================================================================
// Helper: storage key lookup
// =============================================================================

const PENDING_KEYS = [
  { keyName: 'pendingConnectRequestKey',     prefix: 'pendingConnectRequest_',     kind: 'connect' as const },
  { keyName: 'pendingSignRequestKey',        prefix: 'pendingSignRequest_',        kind: 'signMessage' as const },
  { keyName: 'pendingTxRequestKey',          prefix: 'pendingTxRequest_',          kind: 'tx' as const },
  { keyName: 'pendingSignTxRequestKey',      prefix: 'pendingSignTxRequest_',      kind: 'signTx' as const },
  { keyName: 'pendingContractRequestKey',    prefix: 'pendingContractRequest_',    kind: 'contract' as const },
  { keyName: 'pendingEncryptRequestKey',     prefix: 'pendingEncryptRequest_',     kind: 'encrypt' as const },
  { keyName: 'pendingDecryptRequestKey',     prefix: 'pendingDecryptRequest_',     kind: 'decrypt' as const },
  { keyName: 'pendingStealthRequestKey',     prefix: 'pendingStealthRequest_',     kind: 'stealth' as const },
  { keyName: 'pendingClaimRequestKey',       prefix: 'pendingClaimRequest_',       kind: 'claim' as const },
  { keyName: 'pendingSensitiveWriteKey',     prefix: 'pendingSensitiveWrite_',     kind: 'write' as const },
  { keyName: 'pendingEvmTxRequestKey',       prefix: 'pendingEvmTxRequest_',       kind: 'evmTx' as const },
  { keyName: 'pendingEvmSignRequestKey',     prefix: 'pendingEvmSignRequest_',     kind: 'evmSign' as const },
  { keyName: 'pendingEvmTypedDataRequestKey', prefix: 'pendingEvmTypedDataRequest_', kind: 'evmTypedData' as const },
  { keyName: 'pendingEvmTokenRequestKey',    prefix: 'pendingEvmTokenRequest_',    kind: 'evmToken' as const },
  { keyName: 'pendingEvmApproveRequestKey',  prefix: 'pendingEvmApproveRequest_',  kind: 'evmApprove' as const },
  { keyName: 'pendingEvmSwitchRequestKey',  prefix: 'pendingEvmSwitchRequest_',  kind: 'evmSwitchChain' as const },
  { keyName: 'pendingSwitchNetworkRequestKey', prefix: 'pendingSwitchNetworkRequest_', kind: 'switchNetwork' as const },
] as const;

async function loadPendingRequest(): Promise<ActiveRequest | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;

  const allKeyNames = PENDING_KEYS.map(k => k.keyName);
  const stored = await chrome.storage.local.get(allKeyNames);

  for (const entry of PENDING_KEYS) {
    const key = stored[entry.keyName];
    if (!key) continue;

    const dataKey = `${entry.prefix}${key}`;
    const result = await chrome.storage.local.get([dataKey]);
    const data = result[dataKey];
    if (!data) continue;

    return { kind: entry.kind, data } as ActiveRequest;
  }

  return null;
}

/**
 * Canonicalize an origin so cosmetic differences ("https://x.com" vs
 * "https://x.com/") collapse to a single key. Mirrors the rule used by
 * `background.js` so lookups from either side match.
 */
function canonicalizeOrigin(origin: string | undefined | null): string {
  if (!origin) return '';
  const trimmed = origin.trim().replace(/\/+$/, '');
  try { return new URL(trimmed).origin; } catch { return trimmed.toLowerCase(); }
}

// =============================================================================
// Component
// =============================================================================

export function DAppRequestHandler({ wallets }: DAppRequestHandlerProps) {
  const [request, setRequest] = useState<ActiveRequest | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(wallets[0] || null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  // Sync wallet selection when wallets prop updates.
  // We never overwrite an explicitly-selected wallet here — the
  // request-driven effect below picks the wallet bound to the
  // dApp's saved connection, which takes precedence over any
  // first-mount fallback.
  useEffect(() => {
    if (wallets.length > 0 && !selectedWallet) {
      setSelectedWallet(wallets[0]);
    } else if (selectedWallet && !wallets.find(w => w.address === selectedWallet.address)) {
      setSelectedWallet(wallets[0] || null);
    }
  }, [wallets, selectedWallet]);

  // When a request loads (or its origin changes), resolve which wallet the
  // dApp connected with by reading `connectedDApps[origin].walletAddress`
  // from chrome.storage.local. This makes the approval popup operate on the
  // wallet the user picked at connect-time, not the global "active" wallet.
  //
  // Connect requests are the exception — they're the user's chance to pick
  // a wallet for a brand-new connection, so we leave selection alone there.
  useEffect(() => {
    if (!request) return;
    if (request.kind === 'connect') return;

    const origin = (request.data as { appOrigin?: string }).appOrigin;
    if (!origin || typeof chrome === 'undefined' || !chrome.storage?.local) return;

    let cancelled = false;
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['connectedDApps']);
        const dapps = stored.connectedDApps || {};
        const key = canonicalizeOrigin(origin);
        const conn = dapps[key] ?? dapps[origin];
        const walletAddress: string | undefined = conn?.walletAddress;
        if (!walletAddress) return;
        const target = wallets.find(w => w.address === walletAddress);
        if (cancelled || !target) return;
        if (target.address !== selectedWallet?.address) {
          setSelectedWallet(target);
        }
      } catch {
        /* ignore — fall back to current selection */
      }
    })();

    return () => { cancelled = true; };
  }, [request, wallets, selectedWallet]);

  // Initial load + storage change listener
  useEffect(() => {
    loadPendingRequest().then(setRequest);

    const listener = (
      _changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      loadPendingRequest().then(setRequest);
    };

    chrome.storage?.onChanged.addListener(listener);
    return () => chrome.storage?.onChanged.removeListener(listener);
  }, []);

  if (!request) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="text-sm text-muted-foreground">
          No pending requests
        </div>
      </div>
    );
  }

  if (!selectedWallet) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="text-sm text-muted-foreground">No wallet available</div>
      </div>
    );
  }

  // ── Reject helper (used by all flows) ───────────────────────────────────
  const rejectRequest = (resultType: string, pendingKey: string) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    chrome.runtime.sendMessage({
      type: resultType,
      pendingKey,
      approved: false,
    });
    window.close();
  };

  // Route to the right approval screen
  switch (request.kind) {
    case 'connect':
      return (
        <ConnectApproval
          request={request.data}
          wallet={selectedWallet}
          wallets={wallets}
          onSelectWallet={setSelectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('CONNECTION_RESULT', request.data.pendingKey)}
        />
      );
    case 'signMessage':
      return (
        <SignMessageApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('SIGN_MESSAGE_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'tx':
      return (
        <TransactionApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('TX_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'signTx':
      return (
        <SignTxApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('SIGN_TX_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'contract':
      return (
        <ContractApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('CONTRACT_TX_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'encrypt':
    case 'decrypt':
      return (
        <EncryptDecryptApproval
          request={request.data}
          kind={request.kind}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() =>
            rejectRequest(
              request.kind === 'encrypt' ? 'ENCRYPT_BALANCE_RESULT' : 'DECRYPT_BALANCE_RESULT',
              request.data.pendingKey,
            )
          }
          toast={toast}
        />
      );
    case 'stealth':
      return (
        <StealthSendApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('STEALTH_SEND_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'claim':
      return (
        <StealthClaimApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('STEALTH_CLAIM_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'write':
      return (
        <SensitiveWriteApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('SENSITIVE_WRITE_RESULT', request.data.pendingKey)}
        />
      );
    case 'evmTx':
      return (
        <EvmTxApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('EVM_TX_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'evmSign':
      return (
        <EvmSignApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('EVM_SIGN_MESSAGE_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'evmTypedData':
      return (
        <EvmTypedDataApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('EVM_TYPED_DATA_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'evmToken':
      return (
        <EvmTokenApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('EVM_TOKEN_TX_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'evmApprove':
      return (
        <EvmApproveTokenApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('EVM_APPROVE_RESULT', request.data.pendingKey)}
          toast={toast}
        />
      );
    case 'evmSwitchChain':
      return (
        <EvmSwitchChainApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('EVM_SWITCH_CHAIN_RESULT', request.data.pendingKey)}
        />
      );
    case 'switchNetwork':
      return (
        <SwitchNetworkApproval
          request={request.data}
          wallet={selectedWallet}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          onReject={() => rejectRequest('SWITCH_NETWORK_RESULT', request.data.pendingKey)}
        />
      );
  }
}


// =============================================================================
// Permission helpers
// =============================================================================

const PERMISSION_LABELS: Record<string, { label: string; icon: typeof Eye }> = {
  read_address:           { label: 'Read your wallet address',         icon: Eye },
  read_balance:           { label: 'Read your public balance',         icon: Eye },
  read_public_key:        { label: 'Read your public key',             icon: Eye },
  sign_messages:          { label: 'Sign messages with your wallet',   icon: Edit },
  send_transactions:      { label: 'Send transactions on your behalf', icon: Send },
  contract_calls:         { label: 'Call smart contracts',             icon: Edit },
  view_encrypted_balance: { label: 'View your encrypted balance',      icon: Lock },
  encrypt_balance:        { label: 'Move public OCT to encrypted',     icon: Lock },
  decrypt_balance:        { label: 'Move encrypted OCT to public',     icon: Unlock },
  private_transfers:      { label: 'Send private (stealth) transfers', icon: Lock },
  stealth_scan:           { label: 'Scan stealth outputs',             icon: Eye },
  stealth_claim:          { label: 'Claim stealth outputs',            icon: Gift },
};

function PermissionList({ permissions }: { permissions: string[] }) {
  if (!permissions.length) {
    return <div className="text-[11px] text-muted-foreground">No permissions requested.</div>;
  }
  return (
    <ul className="grid grid-cols-1 gap-y-0.5">
      {permissions.map((perm) => {
        const info = PERMISSION_LABELS[perm] || { label: perm, icon: Shield };
        const Icon = info.icon;
        return (
          <li key={perm} className="flex items-center gap-1.5 text-[11px] leading-tight">
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{info.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

// =============================================================================
// Three-region approval shell
// =============================================================================
//
// The popup is locked at 400×600 — the outer body MUST never scroll.
// Every approval renders into ApprovalShell which lays out:
//   1. Header — origin, app name, action title           (fixed)
//      + an optional connected-wallet line showing the active address
//   2. Body   — request details                          (flex-1, scrolls only when content overflows)
//   3. Footer — Reject + Approve button row              (fixed)
//
// Body padding is tight so the typical case fits without any inner
// scrollbar; long messages / contract params get a contained scroll
// area inside the body without ever surfacing through the shell.

function ApprovalShell({
  request,
  title,
  activeAddress,
  body,
  approveLabel,
  approveIcon,
  approveVariant = 'default',
  onApprove,
  onReject,
  isProcessing,
}: {
  request: { appOrigin: string; appName?: string };
  title: string;
  /** When set, shown as a "signing as <addr>" line beneath the header — surfaces the active wallet to every approval after connect. */
  activeAddress?: string;
  body: React.ReactNode;
  approveLabel: string;
  approveIcon?: React.ReactNode;
  approveVariant?: 'default' | 'destructive';
  onApprove: () => void;
  onReject: () => void;
  isProcessing: boolean;
}) {
  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden bg-background">
      {/* Header — fixed */}
      <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-2 space-y-1.5">
        <CompactOriginHeader
          origin={request.appOrigin}
          appName={request.appName}
          title={title}
        />
        {activeAddress ? (
          <ActiveAddressBadge address={activeAddress} />
        ) : null}
      </div>

      {/* Body — only this region scrolls if the content really exceeds the available space */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {body}
      </div>

      {/* Footer — fixed */}
      <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-2">
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-9 flex-1 text-xs"
            onClick={onReject}
            disabled={isProcessing}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            variant={approveVariant === 'destructive' ? 'destructive' : 'default'}
            className="h-9 flex-1 text-xs"
            onClick={onApprove}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>Processing…</>
            ) : (
              <>
                {approveIcon ?? <Check className="mr-1.5 h-3.5 w-3.5" />}
                {approveLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Active wallet badge — full address, no truncation
// =============================================================================

function ActiveAddressBadge({ address }: { address: string }) {
  // Pull the human label if the user has set one in the address book so the
  // badge reads "Wallet 1 · oct…full address". The full address is always
  // shown verbatim — never truncated — so the operator can verify which
  // account is signing without expanding anything.
  const { walletLabels } = useAddressBook();
  const label = walletLabels.find((w) => w.address.toLowerCase() === address.toLowerCase())?.name;

  return (
    <div className="flex items-center gap-1.5 rounded border border-border/70 bg-background/60 px-2 py-1">
      <WalletIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          Signing as{label ? ` · ${label}` : ''}
        </div>
        <div className="break-all font-mono text-[10px]">{address}</div>
      </div>
    </div>
  );
}

// =============================================================================
// Collapsible — used inside approval bodies so each detail block can be
// expanded/collapsed individually instead of forcing the popup body to
// scroll. Every section starts with sensible defaults (the heaviest data
// surfaces collapse by default to keep the popup fitting 600 px).
// =============================================================================

function Collapsible({
  label,
  badge,
  defaultOpen = true,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-muted/30 px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          {label}
        </span>
        {badge ? <span className="shrink-0">{badge}</span> : null}
      </button>
      {open ? <div className="border-t border-border bg-background p-2">{children}</div> : null}
    </div>
  );
}

// =============================================================================
// Compact origin header — fits inside the shell header band
// =============================================================================

function CompactOriginHeader({
  origin,
  appName,
  appIcon,
  title,
}: {
  origin: string;
  appName?: string;
  appIcon?: string;
  title: string;
}) {
  let host = origin;
  try { host = new URL(origin).host; } catch { /* keep raw */ }
  const displayName = appName || host;
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        {appIcon ? <AvatarImage src={appIcon} /> : null}
        <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold">{displayName}</span>
          <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[9px] font-mono">
            <Globe className="mr-0.5 h-2.5 w-2.5" />
            {host}
          </Badge>
        </div>
        <div className="truncate text-[11px] leading-tight text-muted-foreground">{title}</div>
      </div>
    </div>
  );
}

// Every approval body now uses ApprovalShell directly which embeds
// CompactOriginHeader in its own header band — there's no need for a
// stand-alone OriginHeader alias.

// =============================================================================
// Wallet picker — Select dropdown
// =============================================================================
//
// The connect approval is the only screen where the operator can switch
// signing wallet. Renders as a Radix Select so the popup stays compact
// even with many wallets. Pulls the human label from the address book
// (`useAddressBook`) so the dropdown shows "Wallet 1 · oct…full address".

function WalletPicker({
  wallets,
  selected,
  onSelect,
}: {
  wallets: Wallet[];
  selected: Wallet;
  onSelect: (w: Wallet) => void;
}) {
  const { walletLabels } = useAddressBook();

  // For a single wallet there's nothing to choose — show the static badge
  // alongside any other approval headers do.
  if (wallets.length <= 1) {
    return null;
  }

  const labelFor = (w: Wallet) =>
    walletLabels.find((l) => l.address.toLowerCase() === w.address.toLowerCase())?.name
    ?? `Wallet`;

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Wallet ({wallets.length})
      </div>
      <Select
        value={selected.address}
        onValueChange={(addr) => {
          const next = wallets.find((w) => w.address === addr);
          if (next) onSelect(next);
        }}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {labelFor(selected)}
              </span>
              <span className="truncate font-mono text-[10px]">{selected.address}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {wallets.map((w) => (
            <SelectItem key={w.address} value={w.address} className="py-1.5">
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {labelFor(w)}
                </span>
                <span className="break-all font-mono text-[10px]">{w.address}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Legacy ActionFooter is intentionally removed — every approval now wraps
// itself with ApprovalShell which renders the footer.


// =============================================================================
// Connect Approval (octra_requestAccounts)
// =============================================================================

function ConnectApproval({
  request,
  wallet,
  wallets,
  onSelectWallet,
  isProcessing,
  setIsProcessing,
  onReject,
}: {
  request: ConnectRequest;
  wallet: Wallet;
  wallets: Wallet[];
  onSelectWallet: (w: Wallet) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
}) {
  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      // Determine network from active RPC provider
      let network: 'mainnet' | 'devnet' = 'mainnet';
      try {
        const rpcProviders = localStorage.getItem('rpcProviders');
        if (rpcProviders) {
          const providers = JSON.parse(rpcProviders);
          const active = providers.find((p: { isActive: boolean }) => p.isActive);
          if (active?.network) network = active.network;
        }
      } catch {}

      chrome.runtime.sendMessage({
        type: 'CONNECTION_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        walletPubKey: wallet.address,
        address: wallet.address,
        network,
      });
      window.close();
    } catch (error) {
      logger.error('Connect approval failed:', error);
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to connect"
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Connect"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Alert className="py-2">
            <Shield className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              Only connect to sites you trust. The selected wallet's address will be exposed to this site.
            </AlertDescription>
          </Alert>

          <WalletPicker wallets={wallets} selected={wallet} onSelect={onSelectWallet} />

          {wallets.length === 1 ? (
            <ActiveAddressBadge address={wallet.address} />
          ) : null}

          <Collapsible
            label="Permissions"
            badge={
              <span className="text-[10px] text-muted-foreground">
                {request.permissions.length}
              </span>
            }
            defaultOpen
          >
            <PermissionList permissions={request.permissions} />
          </Collapsible>
        </>
      }
    />
  );
}

// =============================================================================
// Sign Message Approval (octra_signMessage)
// =============================================================================

type ToastFn = ReturnType<typeof useToast>['toast'];

function SignMessageApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: SignMessageRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const handleApprove = async () => {
    if (!wallet.privateKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const privateKeyBuffer = Buffer.from(wallet.privateKey, 'base64');
      const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBuffer.slice(0, 32));
      const messageBytes = new TextEncoder().encode(request.message);
      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);

      chrome.runtime.sendMessage({
        type: 'SIGN_MESSAGE_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        address: wallet.address,
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        signature: Buffer.from(signature).toString('hex'),
      });
      window.close();
    } catch (error) {
      logger.error('Sign message failed:', error);
      toast({ title: 'Sign failed', description: String(error), variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to sign a message"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Sign"
      approveIcon={<Edit className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Alert className="py-2">
            <FileText className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              You are signing data with your wallet key. Verify the message before approving.
            </AlertDescription>
          </Alert>

          <Collapsible
            label="Message"
            badge={
              <span className="text-[10px] text-muted-foreground">
                {request.message.length} chars
              </span>
            }
            defaultOpen
          >
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug">
              {request.message}
            </div>
          </Collapsible>
        </>
      }
    />
  );
}

// =============================================================================
// Transaction Approval (octra_sendTransaction)
// =============================================================================

function TransactionApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: TxRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const amountOct = formatRawToOct(request.amount);
  const [chosenOu, setChosenOu] = useState<string>(request.fee || '');

  const handleApprove = async () => {
    if (!wallet.privateKey || !wallet.publicKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const balanceData = await fetchBalance(wallet.address, true);
      const txNonce = balanceData.nonce + 1;

      const amountInOct = Number(request.amount) / 1_000_000;
      const customOu = Number(chosenOu) > 0
        ? Number(chosenOu)
        : (request.fee && Number(request.fee) > 0 ? Number(request.fee) : undefined);

      const tx = createTransaction(
        wallet.address,
        request.to,
        amountInOct,
        txNonce,
        wallet.privateKey,
        wallet.publicKey,
        request.message,
        customOu,
      );

      const result = await sendTransaction(tx);
      if (!result.success || !result.hash) {
        throw new Error(result.error || 'Transaction submission failed');
      }

      chrome.runtime.sendMessage({
        type: 'TX_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: result.hash,
        nonce: txNonce,
        ouCost: tx.ou,
      });
      window.close();
    } catch (error) {
      logger.error('Transaction failed:', error);
      toast({
        title: 'Transaction failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to send a transaction"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Send"
      approveIcon={<Send className="mr-1.5 h-3.5 w-3.5" />}
      approveVariant="destructive"
      body={
        <>
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              This will transfer OCT from your wallet. Verify all details before approving.
            </AlertDescription>
          </Alert>

          <Collapsible label="Transfer · op_type: standard" defaultOpen>
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="To"     value={request.to} mono full />
              <DetailRow label="Amount" value={`${amountOct} OCT`} />
              <DetailRow
                label="Fee"
                value={chosenOu
                  ? `${Number(chosenOu).toLocaleString()} OU ≈ ${ouToOct(Number(chosenOu))} OCT`
                  : 'Auto'}
              />
              {request.message ? <DetailRow label="Message" value={request.message} /> : null}
            </div>
          </Collapsible>

          <FeeSelector
            feeContext="standard"
            dappFee={request.fee}
            onChange={setChosenOu}
          />

          <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] leading-tight text-muted-foreground">
            Once submitted, the transaction enters Octra <strong className="text-foreground">staging</strong>.
            Final confirmation may take several epochs.
          </div>
        </>
      }
    />
  );
}

// =============================================================================
// Sign Tx Approval (octra_signTransaction — sign without submitting)
// =============================================================================

function SignTxApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: SignTxRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const amountOct = formatRawToOct(request.amount);
  const [chosenOu, setChosenOu] = useState<string>(request.fee);

  const handleApprove = async () => {
    if (!wallet.privateKey || !wallet.publicKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const txNonce = request.nonce
        ? Number(request.nonce)
        : (await fetchBalance(wallet.address, true)).nonce + 1;

      const amountInOct = Number(request.amount) / 1_000_000;
      const customOu = Number(chosenOu) > 0 ? Number(chosenOu) : Number(request.fee);

      const tx = createTransaction(
        wallet.address,
        request.to,
        amountInOct,
        txNonce,
        wallet.privateKey,
        wallet.publicKey,
        request.message,
        customOu,
      );

      chrome.runtime.sendMessage({
        type: 'SIGN_TX_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        signedTx: tx,
      });
      window.close();
    } catch (error) {
      toast({
        title: 'Sign failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to sign a transaction"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Sign"
      approveIcon={<Edit className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Alert className="py-2">
            <FileText className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              The transaction will be signed but <strong>not submitted</strong>. The dApp will receive the signed transaction.
            </AlertDescription>
          </Alert>

          <Collapsible label="Sign tx · op_type: standard" defaultOpen>
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="To"     value={request.to} mono full />
              <DetailRow label="Amount" value={`${amountOct} OCT`} />
              <DetailRow
                label="Fee"
                value={`${Number(chosenOu).toLocaleString()} OU ≈ ${ouToOct(Number(chosenOu))} OCT`}
              />
              {request.nonce ? <DetailRow label="Nonce" value={request.nonce} /> : null}
              {request.message ? <DetailRow label="Message" value={request.message} /> : null}
            </div>
          </Collapsible>

          <FeeSelector
            feeContext="standard"
            dappFee={request.fee}
            onChange={setChosenOu}
          />
        </>
      }
    />
  );
}


// =============================================================================
// Contract Approval (octra_sendContractTransaction)
// =============================================================================

function ContractApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: ContractTxRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const amountOct = formatRawToOct(request.amount || '0');
  const [chosenOu, setChosenOu] = useState<string>(request.fee || '');

  const handleApprove = async () => {
    if (!wallet.privateKey || !wallet.publicKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const balanceData = await fetchBalance(wallet.address, true);
      const txNonce = balanceData.nonce + 1;
      const amountInOct = Number(request.amount || '0') / 1_000_000;
      // Prefer the user's selection from the FeeSelector; fall back to the
      // dApp-provided fee, then to the node's default.
      const customOu = Number(chosenOu) > 0
        ? Number(chosenOu)
        : (request.fee && Number(request.fee) > 0 ? Number(request.fee) : undefined);

      // Contract calls in Octra: encrypted_data = method, message = JSON params
      const tx = createTransaction(
        wallet.address,
        request.address,
        amountInOct,
        txNonce,
        wallet.privateKey,
        wallet.publicKey,
        JSON.stringify(request.params || []),
        customOu,
        'call',
        request.method,
      );

      const result = await sendTransaction(tx);
      if (!result.success || !result.hash) {
        throw new Error(result.error || 'Contract call submission failed');
      }

      chrome.runtime.sendMessage({
        type: 'CONTRACT_TX_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: result.hash,
        nonce: txNonce,
        ouCost: tx.ou,
      });
      window.close();
    } catch (error) {
      logger.error('Contract call failed:', error);
      toast({
        title: 'Contract call failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to call a contract"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Call"
      approveIcon={<Send className="mr-1.5 h-3.5 w-3.5" />}
      approveVariant="destructive"
      body={
        <>
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              Contract calls can mutate on-chain state. Verify the contract and method.
            </AlertDescription>
          </Alert>

          <Collapsible
            label={`Contract · op_type: call · method: ${request.method}`}
            defaultOpen
          >
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="Contract" value={request.address} mono full />
              <DetailRow label="Method"   value={request.method}  mono />
              {request.amount && request.amount !== '0' ? (
                <DetailRow label="Attached" value={`${amountOct} OCT`} />
              ) : null}
              <DetailRow
                label="Fee"
                value={chosenOu
                  ? `${Number(chosenOu).toLocaleString()} OU ≈ ${ouToOct(Number(chosenOu))} OCT`
                  : 'Auto'}
              />
            </div>
          </Collapsible>

          <FeeSelector
            feeContext="call"
            dappFee={request.fee}
            onChange={setChosenOu}
          />

          <Collapsible
            label="Params"
            badge={
              <span className="text-[10px] text-muted-foreground">
                {Array.isArray(request.params) ? `${request.params.length} arg(s)` : '0'}
              </span>
            }
            defaultOpen={false}
          >
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug">
              {JSON.stringify(request.params || [], null, 2)}
            </div>
          </Collapsible>
        </>
      }
    />
  );
}

// =============================================================================
// Encrypt / Decrypt Balance Approval
// =============================================================================

function EncryptDecryptApproval({
  request,
  kind,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: EncryptDecryptRequest;
  kind: 'encrypt' | 'decrypt';
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const amountOct = formatRawToOct(request.amount);
  const isEncrypt = kind === 'encrypt';
  const [chosenOu, setChosenOu] = useState<string>(request.fee || '');

  const handleApprove = async () => {
    if (!wallet.privateKey || !wallet.publicKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const { runInWorker } = await import('@/lib/pvac/pvac-worker-client');

      // Build the canonical payload for whichever op is being approved.
      // Encrypt is straightforward — public balance → encrypted, no
      // ciphertext input. Decrypt MUST supply the wallet's current
      // encrypted cipher so the worker can subtract the requested
      // amount and produce a range proof against the new balance;
      // the previous version of this approval forgot that and the
      // node rejected the resulting tx as malformed.
      const balanceData = await fetchBalance(wallet.address, true);
      // Resolve the OU: explicit user choice > dApp-provided > node default.
      const ou = Number(chosenOu) > 0
        ? chosenOu
        : String(request.fee || (await fetchRecommendedFee(isEncrypt ? 'encrypt' : 'decrypt')));

      let workerOp: 'encryptBalance' | 'decryptToPublic';
      let workerInput: Record<string, unknown>;

      if (isEncrypt) {
        workerOp = 'encryptBalance';
        workerInput = {
          privateKey: wallet.privateKey,
          publicKey: wallet.publicKey,
          address: wallet.address,
          amountRaw: request.amount,
          nonce: balanceData.nonce + 1,
          ou,
        };
      } else {
        // Fetch the freshest encrypted-balance cipher straight from
        // the node so we don't operate against stale state.
        const enc = await fetchEncryptedBalance(wallet.address, wallet.privateKey, true);
        const cipher = enc?.cipher;
        if (!cipher || cipher === '0' || !cipher.startsWith('hfhe_v1|')) {
          throw new Error('No encrypted balance to decrypt — call encryptBalance first');
        }
        const enoughEncrypted = (enc?.encrypted ?? 0) * 1_000_000;
        if (enoughEncrypted < Number(request.amount)) {
          throw new Error(`Insufficient encrypted balance: have ${enc?.encrypted ?? 0} OCT`);
        }
        // Use the worker's transaction-building op (decryptToPublic),
        // not the read-only `decryptBalance` cipher reader.
        workerOp = 'decryptToPublic';
        workerInput = {
          privateKey: wallet.privateKey,
          publicKey: wallet.publicKey,
          address: wallet.address,
          amountRaw: request.amount,
          currentCipher: cipher,
          nonce: balanceData.nonce + 1,
          ou,
        };
      }

      const result = await runInWorker<{ tx: import('../types/wallet').Transaction }>(
        workerOp,
        workerInput,
      );
      if (!result.success || !result.data) throw new Error(result.error || 'Operation failed');

      const submit = await sendTransaction(result.data.tx);
      if (!submit.success || !submit.hash) {
        throw new Error(submit.error || 'Submission failed');
      }

      chrome.runtime.sendMessage({
        type: isEncrypt ? 'ENCRYPT_BALANCE_RESULT' : 'DECRYPT_BALANCE_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: submit.hash,
      });
      window.close();
    } catch (error) {
      logger.error(`${kind} failed:`, error);
      toast({
        title: `${isEncrypt ? 'Encrypt' : 'Decrypt'} failed`,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title={isEncrypt ? 'wants to encrypt balance' : 'wants to decrypt balance'}
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel={isEncrypt ? 'Encrypt' : 'Decrypt'}
      approveIcon={
        isEncrypt
          ? <Lock className="mr-1.5 h-3.5 w-3.5" />
          : <Unlock className="mr-1.5 h-3.5 w-3.5" />
      }
      body={
        <>
          <Alert className="py-2">
            {isEncrypt ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            <AlertDescription className="text-[11px] leading-tight">
              {isEncrypt
                ? 'OCT will be moved from your public balance into encrypted balance.'
                : 'OCT will be moved from encrypted balance back to public balance.'}
            </AlertDescription>
          </Alert>

          <Collapsible
            label={`${isEncrypt ? 'Encrypt' : 'Decrypt'} · op_type: ${isEncrypt ? 'encrypt' : 'decrypt'}`}
            defaultOpen
          >
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="Amount" value={`${amountOct} OCT`} />
              <DetailRow
                label="Fee"
                value={chosenOu
                  ? `${Number(chosenOu).toLocaleString()} OU ≈ ${ouToOct(Number(chosenOu))} OCT`
                  : 'Auto'}
              />
            </div>
          </Collapsible>

          <FeeSelector
            feeContext={isEncrypt ? 'encrypt' : 'decrypt'}
            dappFee={request.fee}
            onChange={setChosenOu}
          />

          {!isEncrypt ? (
            <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] leading-tight text-muted-foreground">
              Decrypting requires a range proof and may take several minutes inside the wallet worker.
            </div>
          ) : null}
        </>
      }
    />
  );
}

// =============================================================================
// Stealth Send Approval (octra_sendPrivateTransfer)
// =============================================================================

function StealthSendApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: StealthRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const amountOct = formatRawToOct(request.amount);
  const [chosenOu, setChosenOu] = useState<string>(request.fee || '');

  const handleApprove = async () => {
    if (!wallet.privateKey || !wallet.publicKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const { runInWorker } = await import('@/lib/pvac/pvac-worker-client');

      // Stealth send needs three pieces of state the dApp can't supply:
      //   - the sender's current encrypted balance cipher (for the
      //     range proof against the new balance)
      //   - the recipient's view pubkey (for the ECDH that produces
      //     the stealth tag)
      //   - the latest sender nonce (for replay protection)
      // Fetch them all in parallel before invoking the worker so we
      // don't ship a malformed payload that the node would reject.
      const [balanceData, encrypted, recipientViewPubkey] = await Promise.all([
        fetchBalance(wallet.address, true),
        fetchEncryptedBalance(wallet.address, wallet.privateKey, true),
        getViewPubkey(request.to),
      ]);
      const cipher = encrypted?.cipher;
      if (!cipher || cipher === '0' || !cipher.startsWith('hfhe_v1|')) {
        throw new Error('No encrypted balance — call encryptBalance first');
      }
      if (!recipientViewPubkey) {
        throw new Error('Recipient has no view pubkey — they must register PVAC first');
      }
      const enoughEncrypted = (encrypted?.encrypted ?? 0) * 1_000_000;
      if (enoughEncrypted < Number(request.amount)) {
        throw new Error(`Insufficient encrypted balance: have ${encrypted?.encrypted ?? 0} OCT`);
      }

      const ou = Number(chosenOu) > 0
        ? chosenOu
        : String(request.fee || (await fetchRecommendedFee('stealth')));

      const result = await runInWorker<{ tx: import('../types/wallet').Transaction }>(
        'stealthSend',
        {
          privateKey:           wallet.privateKey,
          publicKey:            wallet.publicKey,
          address:              wallet.address,
          // Worker expects `toAddress`, not `to` — the previous version
          // shipped the wrong field name and the worker built a tx
          // against an empty recipient.
          toAddress:            request.to,
          amountRaw:            request.amount,
          currentCipher:        cipher,
          recipientViewPubkey,
          nonce:                balanceData.nonce + 1,
          ou,
        },
      );
      if (!result.success || !result.data) throw new Error(result.error || 'Stealth send failed');

      const submit = await sendTransaction(result.data.tx);
      if (!submit.success || !submit.hash) {
        throw new Error(submit.error || 'Submission failed');
      }

      chrome.runtime.sendMessage({
        type: 'STEALTH_SEND_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: submit.hash,
      });
      window.close();
    } catch (error) {
      logger.error('Stealth send failed:', error);
      toast({
        title: 'Private transfer failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to send a private transfer"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Send Private"
      approveIcon={<Lock className="mr-1.5 h-3.5 w-3.5" />}
      approveVariant="destructive"
      body={
        <>
          <Alert className="py-2">
            <Lock className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              The amount and recipient will be encrypted on-chain. Recipient must have a registered view public key.
            </AlertDescription>
          </Alert>

          <Collapsible label="Stealth send · op_type: stealth" defaultOpen>
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="To"     value={request.to} mono full />
              <DetailRow label="Amount" value={`${amountOct} OCT`} />
              <DetailRow
                label="Fee"
                value={chosenOu
                  ? `${Number(chosenOu).toLocaleString()} OU ≈ ${ouToOct(Number(chosenOu))} OCT`
                  : 'Auto'}
              />
            </div>
          </Collapsible>

          <FeeSelector
            feeContext="stealth"
            dappFee={request.fee}
            onChange={setChosenOu}
          />

          <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] leading-tight text-muted-foreground">
            Stealth send generates two range proofs locally — expect several minutes inside the wallet worker.
          </div>
        </>
      }
    />
  );
}

// =============================================================================
// Stealth Claim Approval (octra_claimStealth)
// =============================================================================

function StealthClaimApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
  toast,
}: {
  request: ClaimRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ToastFn;
}) {
  const [chosenOu, setChosenOu] = useState<string>(request.fee || '');

  const handleApprove = async () => {
    if (!wallet.privateKey || !wallet.publicKey) {
      toast({ title: 'Wallet locked', description: 'Please unlock your wallet', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const { runInWorker } = await import('@/lib/pvac/pvac-worker-client');

      // The dApp only knows the output id — the worker needs the full
      // stealth output (eph_pub / stealth_tag / enc_amount). Scan the
      // wallet's claimable outputs locally and pick the matching one
      // by id. If no match is found the requested output either was
      // never directed at this wallet or has already been claimed.
      const claimable = await scanStealthOutputs(wallet.privateKey, wallet.address);
      const match = claimable.find((c) => c.id === request.outputId);
      if (!match) {
        throw new Error(`Output ${request.outputId} not found in claimable set`);
      }

      const balanceData = await fetchBalance(wallet.address, true);
      const ou = Number(chosenOu) > 0
        ? chosenOu
        : String(request.fee || (await fetchRecommendedFee('standard')));

      const result = await runInWorker<{ tx: import('../types/wallet').Transaction }>(
        'claimStealth',
        {
          privateKey:    wallet.privateKey,
          publicKey:     wallet.publicKey,
          address:       wallet.address,
          // Worker expects the full output object, not just the id —
          // the previous version shipped only `outputId` and the
          // worker couldn't reconstruct the claim cipher.
          stealthOutput: match.rawOutput,
          nonce:         balanceData.nonce + 1,
          ou,
        },
      );
      if (!result.success || !result.data) throw new Error(result.error || 'Claim failed');

      const submit = await sendTransaction(result.data.tx);
      if (!submit.success || !submit.hash) {
        throw new Error(submit.error || 'Submission failed');
      }

      chrome.runtime.sendMessage({
        type: 'STEALTH_CLAIM_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: submit.hash,
      });
      window.close();
    } catch (error) {
      logger.error('Stealth claim failed:', error);
      toast({
        title: 'Claim failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to claim a stealth output"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Claim"
      approveIcon={<Gift className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Alert className="py-2">
            <Gift className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              Claiming will add the output amount to your encrypted balance.
            </AlertDescription>
          </Alert>

          <Collapsible label="Claim · op_type: claim" defaultOpen>
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="Output ID" value={request.outputId} mono full />
              <DetailRow
                label="Fee"
                value={chosenOu
                  ? `${Number(chosenOu).toLocaleString()} OU ≈ ${ouToOct(Number(chosenOu))} OCT`
                  : 'Auto'}
              />
            </div>
          </Collapsible>

          <FeeSelector
            feeContext="standard"
            dappFee={request.fee}
            onChange={setChosenOu}
          />
        </>
      }
    />
  );
}

// =============================================================================
// Sensitive Write Approval (raw RPC pass-through requiring confirmation)
// =============================================================================

function SensitiveWriteApproval({
  request,
  wallet,
  isProcessing,
  setIsProcessing,
  onReject,
}: {
  request: SensitiveWriteRequest;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
}) {
  const handleApprove = () => {
    setIsProcessing(true);
    chrome.runtime.sendMessage({
      type: 'SENSITIVE_WRITE_RESULT',
      pendingKey: request.pendingKey,
      approved: true,
    });
    window.close();
  };

  // Map raw RPC method onto the matching tx op_type so the operator sees
  // the on-chain effect in plain language alongside the method name.
  const opType = methodToOpType(request.method);

  return (
    <ApprovalShell
      request={request}
      title="wants to perform a write operation"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Approve"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      approveVariant="destructive"
      body={
        <>
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px] leading-tight">
              This is a low-level RPC write call that may modify on-chain state.
            </AlertDescription>
          </Alert>

          <Collapsible
            label={`RPC · op_type: ${opType}`}
            defaultOpen
          >
            <div className="rounded border border-border divide-y divide-border bg-background">
              <DetailRow label="Method" value={request.method} mono full />
            </div>
          </Collapsible>

          <Collapsible
            label="Params"
            badge={
              <span className="text-[10px] text-muted-foreground">
                {Array.isArray(request.params) ? `${request.params.length} arg(s)` : '0'}
              </span>
            }
            defaultOpen={false}
          >
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug">
              {JSON.stringify(request.params || [], null, 2)}
            </div>
          </Collapsible>
        </>
      }
    />
  );
}

// =============================================================================
// Detail row helper
// =============================================================================

function DetailRow({
  label,
  value,
  mono = false,
  full = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** When true, render the value on its own line so long strings (contract addresses,
   *  output ids, RPC methods) are shown verbatim without truncation. */
  full?: boolean;
}) {
  if (full) {
    return (
      <div className="px-2 py-1.5 space-y-0.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={`break-all text-[11px] leading-snug ${mono ? 'font-mono' : ''}`}>
          {value}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-2 px-2 py-1.5">
      <div className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`break-all text-right text-[11px] leading-snug ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/** Format raw OU string to OCT (1 OCT = 1_000_000 OU). */
function formatRawToOct(raw: string): string {
  try {
    const num = Number(raw);
    if (!Number.isFinite(num)) return raw;
    const oct = num / 1_000_000;
    if (oct >= 1) return oct.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return oct.toString();
  } catch {
    return raw;
  }
}

/**
 * Map a raw RPC method name onto the canonical Octra `op_type` it produces.
 * Used by the SensitiveWriteApproval header so the operator sees the on-chain
 * effect at a glance — a method like `octra_submit` or `staging_remove` is
 * meaningless to most users, but `op_type: standard` or `op_type: revert`
 * is.
 *
 * Falls back to the original method when there's no clean mapping.
 */
function methodToOpType(method: string): string {
  switch (method) {
    case 'octra_submit':              return 'standard';
    case 'octra_submitBatch':         return 'standard (batch)';
    case 'octra_privateTransfer':     return 'stealth';
    case 'octra_registerPublicKey':   return 'register pubkey';
    case 'octra_registerPvacPubkey':  return 'register pvac pubkey';
    case 'staging_remove':            return 'revert (staging)';
    case 'contract_verify':           return 'verify (off-chain)';
    case 'contract_saveAbi':          return 'save abi (off-chain)';
    default:                          return method;
  }
}


// =============================================================================
// EVM Approval Components
// =============================================================================

interface EvmApprovalProps<T> {
  request: T;
  wallet: Wallet;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  onReject: () => void;
  toast: ReturnType<typeof useToast>['toast'];
}

/**
 * Shared helper: derive EVM private key from the current wallet's Octra key,
 * sign with ethers inside the popup, return the tx hash to background.
 * This keeps the private key isolated to the popup process only.
 */
async function getEvmPrivateKeyHex(wallet: Wallet): Promise<string> {
  const { deriveEvmFromOctraKey } = await import('../utils/evmDerive');
  return deriveEvmFromOctraKey(wallet.privateKey).privateKeyHex;
}

async function getEvmRpcUrlForChain(chainId: number): Promise<string> {
  const { getEVMRpcUrl, getAllNetworks } = await import('../utils/evmRpc');
  const all = getAllNetworks();
  const net = all.find(n => n.chainId === chainId);
  if (!net) throw new Error(`No network with chainId ${chainId}`);
  return getEVMRpcUrl(net.id);
}

// ── EVM Send Transaction ─────────────────────────────────────────────────────

function EvmTxApproval({ request, wallet, isProcessing, setIsProcessing, onReject, toast }: EvmApprovalProps<EvmTxRequest>) {
  const [gasOverrides, setGasOverrides] = useState<EvmGasOverrides>({
    gasLimit: request.gasLimit ?? '',
    maxFeePerGasGwei: '',
    maxPriorityFeePerGasGwei: AUTO_PRIORITY_TIP_GWEI,
  });
  const [rpcUrl, setRpcUrl] = useState<string>('');

  useEffect(() => {
    void getEvmRpcUrlForChain(request.chainId).then(setRpcUrl).catch(() => {});
  }, [request.chainId]);

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      const pkHex = await getEvmPrivateKeyHex(wallet);
      const url = rpcUrl || (await getEvmRpcUrlForChain(request.chainId));
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(url);
      const signer = new ethers.Wallet(pkHex.startsWith('0x') ? pkHex : `0x${pkHex}`, provider);

      const txReq: Record<string, unknown> = { to: request.to };
      if (request.value && request.value !== '0') txReq.value = ethers.parseEther(request.value);
      if (request.data) txReq.data = request.data.startsWith('0x') ? request.data : `0x${request.data}`;

      // Apply user-selected gas overrides on top of the dApp-supplied
      // baseline. ethers will fill in anything we leave blank from
      // live network fee data.
      const gasPatch = await buildEvmGasPatch(gasOverrides);
      Object.assign(txReq, gasPatch);

      const tx = await signer.sendTransaction(txReq as Parameters<typeof signer.sendTransaction>[0]);

      chrome.runtime.sendMessage({
        type: 'EVM_TX_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: tx.hash,
        chainId: request.chainId,
      });
      window.close();
    } catch (err) {
      setIsProcessing(false);
      toast({ title: 'Transaction Failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const valueDisplay = request.value && request.value !== '0'
    ? `${request.value} ${request.symbol}`
    : `0 ${request.symbol}`;

  return (
    <ApprovalShell
      request={request}
      title="wants to send an EVM transaction"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Send"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Collapsible label={`evm · ${request.networkName}`} defaultOpen>
            <DetailRow label="to" value={request.to} full />
            <DetailRow label="value" value={valueDisplay} />
            <DetailRow label="chain" value={`${request.networkName} (${request.chainId})`} />
            {request.data && <DetailRow label="data" value={request.data.slice(0, 66) + (request.data.length > 66 ? '…' : '')} />}
            {request.gasLimit && <DetailRow label="gas hint" value={request.gasLimit} />}
          </Collapsible>

          {rpcUrl && (
            <EvmGasSelector
              rpcUrl={rpcUrl}
              dappGasLimit={request.gasLimit}
              onChange={setGasOverrides}
            />
          )}
        </>
      }
    />
  );
}

// ── EVM Sign Message ─────────────────────────────────────────────────────────

function EvmSignApproval({ request, wallet, isProcessing, setIsProcessing, onReject, toast }: EvmApprovalProps<EvmSignMessageRequest>) {
  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      const pkHex = await getEvmPrivateKeyHex(wallet);
      const { ethers } = await import('ethers');
      const signer = new ethers.Wallet(pkHex.startsWith('0x') ? pkHex : `0x${pkHex}`);
      const signature = await signer.signMessage(request.message);

      chrome.runtime.sendMessage({
        type: 'EVM_SIGN_MESSAGE_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        signature,
        address: signer.address,
      });
      window.close();
    } catch (err) {
      setIsProcessing(false);
      toast({ title: 'Sign Failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to sign a message (EVM)"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Sign"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <Collapsible label="evm · personal_sign" defaultOpen>
          <div className="rounded bg-muted p-2 text-[11px] font-mono break-all max-h-32 overflow-y-auto">
            {request.message}
          </div>
        </Collapsible>
      }
    />
  );
}

// ── EVM Sign Typed Data (EIP-712) ────────────────────────────────────────────

function EvmTypedDataApproval({ request, wallet, isProcessing, setIsProcessing, onReject, toast }: EvmApprovalProps<EvmTypedDataRequest>) {
  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      const pkHex = await getEvmPrivateKeyHex(wallet);
      const { ethers } = await import('ethers');
      const signer = new ethers.Wallet(pkHex.startsWith('0x') ? pkHex : `0x${pkHex}`);

      // Remove EIP712Domain from types before calling signTypedData
      const types = { ...(request.types as Record<string, Array<{ name: string; type: string }>>) };
      delete types['EIP712Domain'];

      const signature = await signer.signTypedData(
        request.domain as Parameters<typeof signer.signTypedData>[0],
        types,
        request.value,
      );

      chrome.runtime.sendMessage({
        type: 'EVM_TYPED_DATA_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        signature,
        address: signer.address,
      });
      window.close();
    } catch (err) {
      setIsProcessing(false);
      toast({ title: 'Sign Failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to sign structured data (EIP-712)"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Sign"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Collapsible label="domain" defaultOpen>
            <div className="rounded bg-muted p-2 text-[11px] font-mono break-all max-h-24 overflow-y-auto">
              {JSON.stringify(request.domain, null, 2)}
            </div>
          </Collapsible>
          <Collapsible label="message">
            <div className="rounded bg-muted p-2 text-[11px] font-mono break-all max-h-40 overflow-y-auto">
              {JSON.stringify(request.value, null, 2)}
            </div>
          </Collapsible>
        </>
      }
    />
  );
}

// ── EVM Token Transfer ───────────────────────────────────────────────────────

function EvmTokenApproval({ request, wallet, isProcessing, setIsProcessing, onReject, toast }: EvmApprovalProps<EvmTokenTxRequest>) {
  const [gasOverrides, setGasOverrides] = useState<EvmGasOverrides>({
    gasLimit: '',
    maxFeePerGasGwei: '',
    maxPriorityFeePerGasGwei: AUTO_PRIORITY_TIP_GWEI,
  });
  const [rpcUrl, setRpcUrl] = useState<string>('');

  useEffect(() => {
    void getEvmRpcUrlForChain(request.chainId).then(setRpcUrl).catch(() => {});
  }, [request.chainId]);

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      const pkHex = await getEvmPrivateKeyHex(wallet);
      const url = rpcUrl || (await getEvmRpcUrlForChain(request.chainId));
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(url);
      const signer = new ethers.Wallet(pkHex.startsWith('0x') ? pkHex : `0x${pkHex}`, provider);

      const erc20 = new ethers.Contract(request.token, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
      const gasPatch = await buildEvmGasPatch(gasOverrides);
      const tx = await erc20.transfer(request.to, BigInt(request.amount), gasPatch);

      chrome.runtime.sendMessage({
        type: 'EVM_TOKEN_TX_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: tx.hash,
        chainId: request.chainId,
      });
      window.close();
    } catch (err) {
      setIsProcessing(false);
      toast({ title: 'Transfer Failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to transfer tokens (ERC-20)"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Transfer"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <>
          <Collapsible label={`erc-20 · ${request.networkName}`} defaultOpen>
            <DetailRow label="token" value={request.token} full />
            <DetailRow label="to" value={request.to} full />
            <DetailRow label="amount" value={`${request.amount} (smallest unit)`} />
            <DetailRow label="chain" value={`${request.networkName} (${request.chainId})`} />
          </Collapsible>

          {rpcUrl && (
            <EvmGasSelector
              rpcUrl={rpcUrl}
              onChange={setGasOverrides}
            />
          )}
        </>
      }
    />
  );
}

// ── EVM Token Approve ────────────────────────────────────────────────────────

function EvmApproveTokenApproval({ request, wallet, isProcessing, setIsProcessing, onReject, toast }: EvmApprovalProps<EvmApproveRequest>) {
  const isUnlimited = request.amount === '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  const [gasOverrides, setGasOverrides] = useState<EvmGasOverrides>({
    gasLimit: '',
    maxFeePerGasGwei: '',
    maxPriorityFeePerGasGwei: AUTO_PRIORITY_TIP_GWEI,
  });
  const [rpcUrl, setRpcUrl] = useState<string>('');

  useEffect(() => {
    void getEvmRpcUrlForChain(request.chainId).then(setRpcUrl).catch(() => {});
  }, [request.chainId]);

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      const pkHex = await getEvmPrivateKeyHex(wallet);
      const url = rpcUrl || (await getEvmRpcUrlForChain(request.chainId));
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(url);
      const signer = new ethers.Wallet(pkHex.startsWith('0x') ? pkHex : `0x${pkHex}`, provider);

      const erc20 = new ethers.Contract(request.token, ['function approve(address spender, uint256 amount) returns (bool)'], signer);
      const gasPatch = await buildEvmGasPatch(gasOverrides);
      const tx = await erc20.approve(request.spender, BigInt(request.amount), gasPatch);

      chrome.runtime.sendMessage({
        type: 'EVM_APPROVE_RESULT',
        pendingKey: request.pendingKey,
        approved: true,
        hash: tx.hash,
        chainId: request.chainId,
      });
      window.close();
    } catch (err) {
      setIsProcessing(false);
      toast({ title: 'Approve Failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to approve token spending"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Approve"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      approveVariant="destructive"
      body={
        <>
          {isUnlimited && (
            <Alert variant="destructive" className="py-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertDescription className="text-[11px] leading-tight">
                This grants unlimited spending approval. The spender can transfer all your tokens of this type.
              </AlertDescription>
            </Alert>
          )}
          <Collapsible label={`erc-20 approve · ${request.networkName}`} defaultOpen>
            <DetailRow label="token" value={request.token} full />
            <DetailRow label="spender" value={request.spender} full />
            <DetailRow label="amount" value={isUnlimited ? '∞ (unlimited)' : request.amount} />
            <DetailRow label="chain" value={`${request.networkName} (${request.chainId})`} />
          </Collapsible>

          {rpcUrl && (
            <EvmGasSelector
              rpcUrl={rpcUrl}
              onChange={setGasOverrides}
            />
          )}
        </>
      }
    />
  );
}


// ── EVM Switch Chain Approval ────────────────────────────────────────────────

function EvmSwitchChainApproval({ request, wallet, isProcessing, setIsProcessing, onReject }: Omit<EvmApprovalProps<EvmSwitchChainRequest>, 'toast'>) {
  // Re-resolve the "from" chain at popup mount time to overcome any
  // staleness in the background's chrome.storage.local — the wallet UI's
  // localStorage is the source of truth for what the user actually sees.
  const [fromOverride, setFromOverride] = useState<{ chainId: number; name: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { getActiveEVMNetwork } = await import('../utils/evmRpc');
        const active = getActiveEVMNetwork();
        if (active.chainId !== request.fromChainId) {
          setFromOverride({ chainId: active.chainId, name: active.name });
        }
      } catch { /* keep request.fromChainId */ }
    })();
  }, [request.fromChainId]);

  const fromChainId = fromOverride?.chainId ?? request.fromChainId;
  const fromName = fromOverride?.name ?? request.fromName;

  const handleApprove = async () => {
    setIsProcessing(true);
    // Write to localStorage directly from the popup — background can't access it.
    // This ensures the wallet UI picks up the new chain when it next renders.
    const { setActiveEVMNetwork, getAllNetworks } = await import('../utils/evmRpc');
    const targetNetworks = getAllNetworks();
    const target = targetNetworks.find(n => n.chainId === request.toChainId);
    if (target) {
      setActiveEVMNetwork(target.id);
    }
    await chrome.runtime.sendMessage({
      type: 'EVM_SWITCH_CHAIN_RESULT',
      pendingKey: request.pendingKey,
      approved: true,
    });
    await new Promise(r => setTimeout(r, 100));
    window.close();
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to switch your EVM network"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Switch"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <Collapsible label="evm · switch chain" defaultOpen>
          <DetailRow label="from" value={`${fromName} (chain ${fromChainId})`} />
          <DetailRow label="to" value={`${request.toName} (chain ${request.toChainId})`} />
          <DetailRow label="native token" value={request.toSymbol} />
        </Collapsible>
      }
    />
  );
}


// ── Octra Switch Network Approval ────────────────────────────────────────────

function SwitchNetworkApproval({ request, wallet, isProcessing, setIsProcessing, onReject }: Omit<EvmApprovalProps<SwitchNetworkRequest>, 'toast'>) {
  const handleApprove = async () => {
    setIsProcessing(true);
    // Write rpcProviders to localStorage directly — background can't.
    // Find the matching provider and flip isActive so the wallet UI reads
    // the correct active network on its next mount.
    try {
      const providersJson = localStorage.getItem('rpcProviders');
      if (providersJson) {
        const providers = JSON.parse(providersJson) as Array<{ id: string; url: string; network?: string; isActive: boolean }>;
        const wantsDevnet = request.toNetworkId.includes('devnet');
        const targetProvider = providers.find(p => {
          if (p.network === 'devnet') return wantsDevnet;
          if (p.network === 'mainnet') return !wantsDevnet;
          return wantsDevnet ? p.url.includes('165.227.225.79') : !p.url.includes('165.227.225.79');
        });
        if (targetProvider) {
          const updated = providers.map(p => ({ ...p, isActive: p.id === targetProvider.id }));
          localStorage.setItem('rpcProviders', JSON.stringify(updated));
          localStorage.setItem('selectedNetwork', targetProvider.network ?? (wantsDevnet ? 'devnet' : 'mainnet'));
        }
      }
    } catch (e) {
      console.warn('[SwitchNetworkApproval] Failed to sync localStorage:', e);
    }
    await chrome.runtime.sendMessage({
      type: 'SWITCH_NETWORK_RESULT',
      pendingKey: request.pendingKey,
      approved: true,
    });
    await new Promise(r => setTimeout(r, 100));
    window.close();
  };

  return (
    <ApprovalShell
      request={request}
      title="wants to switch your Octra network"
      activeAddress={wallet.address}
      isProcessing={isProcessing}
      onApprove={handleApprove}
      onReject={onReject}
      approveLabel="Switch"
      approveIcon={<Check className="mr-1.5 h-3.5 w-3.5" />}
      body={
        <Collapsible label="octra · switch network" defaultOpen>
          <DetailRow label="from" value={`${request.fromName} (${request.fromNetworkId})`} />
          <DetailRow label="to" value={`${request.toName} (${request.toNetworkId})`} />
        </Collapsible>
      }
    />
  );
}


// =============================================================================
// FeeSelector — choose between auto / fast / custom OU for any approval flow
// =============================================================================

type FeeOption = 'auto' | 'fast' | 'custom';

interface FeeSelectorProps {
  /** Octra op_type used to ask the node for a recommended fee. */
  feeContext: 'standard' | 'call' | 'encrypt' | 'decrypt' | 'stealth';
  /** Optional fixed fee suggested by the dApp. When present and the user
   *  picks "auto", we use this instead of the node's recommendation. */
  dappFee?: string;
  /** Returns the resolved OU value as a string whenever the selection changes. */
  onChange: (ouValue: string) => void;
}

/**
 * Mirror of the SendTransaction fee picker, scaled down for the popup body.
 * Three modes:
 *   - auto:   node's recommended fee for the op_type
 *   - fast:   2× recommended (priority pricing)
 *   - custom: user-provided OU value
 *
 * The component is fully self-contained and stateless above it — every
 * change is reported back through `onChange` so the parent can include
 * the chosen OU in its signed transaction.
 */
function FeeSelector({ feeContext, dappFee, onChange }: FeeSelectorProps) {
  const [option, setOption] = useState<FeeOption>('auto');
  const [customOu, setCustomOu] = useState('');
  const [recommendedOu, setRecommendedOu] = useState<number>(1000);
  const [isFetching, setIsFetching] = useState(false);

  // Node-recommended fee — fetched once on mount, refreshed only on context change.
  useEffect(() => {
    let cancelled = false;
    setIsFetching(true);
    fetchRecommendedFee(feeContext)
      .then((ou) => { if (!cancelled) setRecommendedOu(ou); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsFetching(false); });
    return () => { cancelled = true; };
  }, [feeContext]);

  // Resolve the chosen OU value any time the inputs change.
  useEffect(() => {
    let resolved: number;
    if (option === 'fast') {
      resolved = recommendedOu * 2;
    } else if (option === 'custom') {
      const parsed = parseInt(customOu, 10);
      resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : recommendedOu;
    } else {
      // auto: prefer dApp-provided fee, else node recommendation
      const dappOu = dappFee ? Number(dappFee) : NaN;
      resolved = Number.isFinite(dappOu) && dappOu > 0 ? dappOu : recommendedOu;
    }
    onChange(String(resolved));
  }, [option, customOu, recommendedOu, dappFee, onChange]);

  const recommendedLabel = isFetching
    ? 'fetching…'
    : `${recommendedOu.toLocaleString()} OU ≈ ${ouToOct(recommendedOu)} OCT`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Network fee</span>
        <span className="text-[10px] text-muted-foreground">
          recommended: {recommendedLabel}
        </span>
      </div>
      <Select value={option} onValueChange={(v) => setOption(v as FeeOption)}>
        <SelectTrigger className="h-7 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto" className="text-[11px]">
            Auto ({recommendedOu.toLocaleString()} OU ≈ {ouToOct(recommendedOu)} OCT)
          </SelectItem>
          <SelectItem value="fast" className="text-[11px]">
            Fast ({(recommendedOu * 2).toLocaleString()} OU ≈ {ouToOct(recommendedOu * 2)} OCT)
          </SelectItem>
          <SelectItem value="custom" className="text-[11px]">
            Custom
          </SelectItem>
        </SelectContent>
      </Select>
      {option === 'custom' && (
        <input
          type="number"
          min="1"
          step="1"
          value={customOu}
          onChange={(e) => setCustomOu(e.target.value)}
          placeholder={`Enter OU (recommended: ${recommendedOu})`}
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11px] outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}
    </div>
  );
}


// =============================================================================
// EvmGasSelector — auto / fast / custom gas controls for EVM approvals
// =============================================================================

type EvmGasOption = 'auto' | 'fast' | 'custom';

export interface EvmGasOverrides {
  /** Custom gas-limit override (decimal, e.g. "150000"). Empty string = auto. */
  gasLimit: string;
  /** Custom maxFeePerGas in Gwei. Empty string = auto. */
  maxFeePerGasGwei: string;
  /** Custom maxPriorityFeePerGas in Gwei. Empty string = auto. */
  maxPriorityFeePerGasGwei: string;
}

interface EvmGasSelectorProps {
  /** RPC URL used to read the network's current fee data. */
  rpcUrl: string;
  /** Optional dApp-supplied gas-limit hint (decimal string). Used as the
   *  baseline when the user picks "auto". */
  dappGasLimit?: string;
  onChange: (overrides: EvmGasOverrides) => void;
}

const FAST_PRIORITY_TIP_GWEI = '1.0';   // bumped from the typical 0.1 tip
const AUTO_PRIORITY_TIP_GWEI = '0.1';   // mirrors what evmRpc.ts uses today

/**
 * EVM gas picker — three modes:
 *   - auto:   baseFee × 1.10 + 0.1 Gwei tip, dApp's gasLimit hint if present
 *   - fast:   baseFee × 1.10 + 1.0 Gwei tip — same gas limit
 *   - custom: user-typed limit + max fee + priority tip in Gwei
 *
 * The selector polls the network's `eth_feeData` once on mount so the
 * "auto" / "fast" labels can show realistic gwei numbers. The parent
 * handler is responsible for converting Gwei strings to wei via
 * `ethers.parseUnits(_, 'gwei')` before signing.
 */
function EvmGasSelector({ rpcUrl, dappGasLimit, onChange }: EvmGasSelectorProps) {
  const [option, setOption] = useState<EvmGasOption>('auto');
  const [customGasLimit, setCustomGasLimit] = useState('');
  const [customMaxFee, setCustomMaxFee] = useState('');
  const [customPriority, setCustomPriority] = useState('');

  const [baseFeeGwei, setBaseFeeGwei] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  // Pull live network fee data so the labels reflect actual mainnet pricing.
  useEffect(() => {
    let cancelled = false;
    setIsFetching(true);
    (async () => {
      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const fee = await provider.getFeeData();
        if (cancelled || !fee.maxFeePerGas || !fee.maxPriorityFeePerGas) return;
        const base = fee.maxFeePerGas - fee.maxPriorityFeePerGas;
        setBaseFeeGwei(ethers.formatUnits(base, 'gwei'));
      } catch {
        /* keep null — auto/fast labels fall back to "—" */
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rpcUrl]);

  // Resolve the chosen overrides any time inputs change.
  useEffect(() => {
    if (option === 'custom') {
      onChange({
        gasLimit:                 customGasLimit.trim(),
        maxFeePerGasGwei:         customMaxFee.trim(),
        maxPriorityFeePerGasGwei: customPriority.trim(),
      });
      return;
    }
    // For auto / fast we let the underlying ethers signer compute most of
    // the fee data, but propagate the user's intent for the priority tip.
    // The signer has access to live base fee through getFeeData() at sign
    // time, so we don't have to repeat that lookup here.
    onChange({
      gasLimit:                 dappGasLimit ?? '',
      maxFeePerGasGwei:         '',
      maxPriorityFeePerGasGwei: option === 'fast' ? FAST_PRIORITY_TIP_GWEI : AUTO_PRIORITY_TIP_GWEI,
    });
  }, [option, customGasLimit, customMaxFee, customPriority, dappGasLimit, onChange]);

  const baseLabel = isFetching
    ? 'fetching…'
    : baseFeeGwei
      ? `base ≈ ${parseFloat(baseFeeGwei).toFixed(3)} Gwei`
      : 'base —';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Gas</span>
        <span className="text-[10px] text-muted-foreground">{baseLabel}</span>
      </div>
      <Select value={option} onValueChange={(v) => setOption(v as EvmGasOption)}>
        <SelectTrigger className="h-7 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto" className="text-[11px]">
            Auto (tip {AUTO_PRIORITY_TIP_GWEI} Gwei)
          </SelectItem>
          <SelectItem value="fast" className="text-[11px]">
            Fast (tip {FAST_PRIORITY_TIP_GWEI} Gwei)
          </SelectItem>
          <SelectItem value="custom" className="text-[11px]">
            Custom
          </SelectItem>
        </SelectContent>
      </Select>
      {option === 'custom' && (
        <div className="grid grid-cols-3 gap-1.5">
          <input
            type="number"
            min="0"
            step="any"
            value={customGasLimit}
            onChange={(e) => setCustomGasLimit(e.target.value)}
            placeholder="gas limit"
            className="h-7 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <input
            type="number"
            min="0"
            step="any"
            value={customMaxFee}
            onChange={(e) => setCustomMaxFee(e.target.value)}
            placeholder="max fee Gwei"
            className="h-7 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <input
            type="number"
            min="0"
            step="any"
            value={customPriority}
            onChange={(e) => setCustomPriority(e.target.value)}
            placeholder="tip Gwei"
            className="h-7 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Translate `EvmGasOverrides` into ethers TransactionRequest fields. Returns
 * an empty patch when nothing is overridden — ethers will then fall back to
 * its automatic estimation. Defined here so the four EVM approval
 * components can share one parser.
 */
async function buildEvmGasPatch(
  overrides: EvmGasOverrides,
): Promise<Record<string, bigint | number>> {
  const patch: Record<string, bigint | number> = {};
  if (!overrides) return patch;

  const { ethers } = await import('ethers');

  if (overrides.gasLimit) {
    const n = BigInt(Math.floor(Number(overrides.gasLimit)));
    if (n > 0n) patch.gasLimit = n;
  }
  if (overrides.maxFeePerGasGwei) {
    try {
      patch.maxFeePerGas = ethers.parseUnits(overrides.maxFeePerGasGwei, 'gwei');
      patch.type = 2;
    } catch { /* ignore parse errors */ }
  }
  if (overrides.maxPriorityFeePerGasGwei) {
    try {
      patch.maxPriorityFeePerGas = ethers.parseUnits(overrides.maxPriorityFeePerGasGwei, 'gwei');
      patch.type = 2;
    } catch { /* ignore parse errors */ }
  }
  return patch;
}
