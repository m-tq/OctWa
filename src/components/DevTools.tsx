import { useState, useCallback, useRef } from 'react';
import * as nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Code2, X, Play, Upload, Eye, Send, FileCode,
  ChevronRight, Loader2, CheckCircle2, AlertCircle,
  Copy, Check, RefreshCw, Terminal, Braces, Layers,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Wallet } from '../types/wallet';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DevToolsProps {
  wallet: Wallet;
  onExit: () => void;
  activeNetwork: string;
}

interface CompileResult {
  bytecode:     string;
  abi:          string; // JSON string: { functions: [{name, inputs, output, view, payable}], events: [...] }
  instructions: number;
  size:         number;
  version:      string;
  disasm:       string;
}

interface AbiFunction {
  name:    string;
  inputs:  Array<string | { name: string; type: string }>;
  output:  string;
  view:    boolean;
  payable: boolean;
}

interface AbiEvent {
  name:   string;
  inputs: Array<string | { name: string; type: string }>;
}

interface ParsedAbi {
  functions: AbiFunction[];
  events:    AbiEvent[];
}

function parseAbi(raw: string): ParsedAbi {
  const empty: ParsedAbi = { functions: [], events: [] };
  if (!raw) return empty;
  try {
    // ABI may be double-encoded: a string containing escaped JSON
    let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // If still a string, parse again
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);

    if (parsed && Array.isArray(parsed.functions)) {
      return {
        functions: parsed.functions ?? [],
        events:    parsed.events    ?? [],
      };
    }
    // Fallback: flat array of {name, view}
    if (Array.isArray(parsed)) {
      return {
        functions: parsed.map((f: { name: string; view?: boolean }) => ({
          name: f.name, inputs: [], output: 'bool', view: !!f.view, payable: false,
        })),
        events: [],
      };
    }
  } catch { /* ignore */ }
  return empty;
}

function formatInputs(inputs: Array<string | { name: string; type: string }>): string {
  return inputs.map(p => typeof p === 'string' ? p : `${p.name}: ${p.type}`).join(', ');
}

interface DeployResult {
  address: string;
  tx_hash: string;
}

interface CallResult {
  result: unknown;
  raw: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRpcUrl(): string {
  try {
    const saved = localStorage.getItem('rpcProviders');
    if (saved) {
      const providers = JSON.parse(saved);
      const active = providers.find((p: { isActive: boolean; url: string }) => p.isActive);
      if (active?.url) return active.url.replace(/\/$/, '');
    }
  } catch { /* ignore */ }
  return 'http://46.101.86.250:8080';
}

async function octraRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const url = getRpcUrl();
  const res = await fetch(`${url}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result as T;
}

// ── Canonical tx signing (matches webcli tx_builder.hpp) ─────────────────────
// Derives public key from private key seed — no RPC call needed.
// canonical order: from, to_, amount, nonce, ou, timestamp, op_type, [encrypted_data], [message]
function signTx(
  fields:        Record<string, unknown>,
  privateKeyB64: string,
): { signature: string; public_key: string } {
  const signingData = JSON.stringify(fields);
  const privBuf = Buffer.from(privateKeyB64, 'base64');
  // Derive keypair from 32-byte seed
  const kp = nacl.sign.keyPair.fromSeed(privBuf.slice(0, 32));
  const sig = nacl.sign.detached(new TextEncoder().encode(signingData), kp.secretKey);
  return {
    signature:  Buffer.from(sig).toString('base64'),
    public_key: Buffer.from(kp.publicKey).toString('base64'),
  };
}

const DEFAULT_AML = `contract Counter {
  state {
    owner:   address
    counter: int
  }

  event Incremented(by: address, value: int)

  constructor() {
    self.owner = caller
    self.counter = 0
  }

  fn increment(): bool {
    self.counter += 1
    emit Incremented(caller, self.counter)
    return true
  }

  view fn get_counter(): int { return self.counter }
  view fn get_owner(): address { return self.owner }
}`;

// ── Component ─────────────────────────────────────────────────────────────────

export function DevTools({ wallet, onExit, activeNetwork }: DevToolsProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('editor');

  // Editor
  const [source, setSource] = useState(DEFAULT_AML);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Deploy
  const [constructorParams, setConstructorParams] = useState('[]');
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState<DeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);

  // Call
  const [callAddress, setCallAddress] = useState('');
  const [callMethod, setCallMethod] = useState('');
  const [callParams, setCallParams] = useState('[]');
  const [callAmount, setCallAmount] = useState('0');
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<CallResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [callMode, setCallMode] = useState<'view' | 'send'>('view');

  // Storage
  const [storageAddress, setStorageAddress] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [storageResult, setStorageResult] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);

  // Copy
  const [copied, setCopied] = useState<string | null>(null);

  // Editor refs for scroll sync
  const gutterRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  // ── Compile ────────────────────────────────────────────────────────────────

  const handleCompile = useCallback(async () => {
    if (!source.trim()) return;
    setCompiling(true);
    setCompileError(null);
    setCompiled(null);
    try {
      const result = await octraRpc<CompileResult>('octra_compileAml', [source]);
      setCompiled(result);
      setActiveTab('deploy');
      toast({ title: 'Compiled', description: `${result.instructions} instructions, ${result.size} bytes` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCompileError(msg);
    } finally {
      setCompiling(false);
    }
  }, [source, toast]);

  // ── Preview address ────────────────────────────────────────────────────────

  const handlePreviewAddress = useCallback(async () => {
    if (!compiled?.bytecode) return;
    try {
      // octra_computeContractAddress returns { address, deployer, nonce }
      const result = await octraRpc<{ address: string }>('octra_computeContractAddress', [compiled.bytecode, wallet.address]);
      setPreviewAddress(result.address);
    } catch (e) {
      toast({ title: 'Preview failed', description: String(e), variant: 'destructive' });
    }
  }, [compiled, wallet.address, toast]);

  // ── Deploy ─────────────────────────────────────────────────────────────────

  const handleDeploy = useCallback(async () => {
    if (!compiled?.bytecode) return;
    let params: unknown[];
    try { params = JSON.parse(constructorParams); }
    catch { toast({ title: 'Invalid params', description: 'Must be a JSON array', variant: 'destructive' }); return; }

    setDeploying(true);
    setDeployError(null);
    setDeployed(null);
    try {
      const nonceResult = await octraRpc<{ nonce: number }>('octra_nonce', [wallet.address]);
      const txNonce = nonceResult.nonce + 1;
      const timestamp = Date.now() / 1000;

      // Compute contract address first — webcli sets to_ = contract_addr, not ""
      const addrResult = await octraRpc<{ address: string }>(
        'octra_computeContractAddress',
        [compiled.bytecode, wallet.address, txNonce]
      );
      const contractAddr = addrResult.address || '';

      // canonical order: from, to_, amount, nonce, ou, timestamp, op_type, encrypted_data, [message]
      const canonicalFields: Record<string, unknown> = {
        from:           wallet.address,
        to_:            contractAddr,
        amount:         '0',
        nonce:          txNonce,
        ou:             '50000000',
        timestamp,
        op_type:        'deploy',
        encrypted_data: compiled.bytecode,
      };
      const paramsStr = JSON.stringify(params);
      if (paramsStr !== '[]') canonicalFields.message = paramsStr;

      const { signature, public_key } = signTx(canonicalFields, wallet.privateKey);

      const submitResult = await octraRpc<{ tx_hash: string; status: string }>('octra_submit', [
        { ...canonicalFields, signature, public_key }
      ]);
      if (submitResult.status === 'rejected') throw new Error('Transaction rejected');

      setDeployed({ address: contractAddr, tx_hash: submitResult.tx_hash });
      setCallAddress(contractAddr);
      setPreviewAddress(contractAddr);
      toast({ title: 'Deployed!', description: submitResult.tx_hash.slice(0, 20) + '...' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDeployError(msg);
    } finally {
      setDeploying(false);
    }
  }, [compiled, constructorParams, wallet, previewAddress, toast]);

  // ── Call ───────────────────────────────────────────────────────────────────

  const handleCall = useCallback(async () => {
    if (!callAddress || !callMethod) return;
    let params: unknown[];
    try { params = JSON.parse(callParams); }
    catch { toast({ title: 'Invalid params', variant: 'destructive' }); return; }

    setCalling(true);
    setCallError(null);
    setCallResult(null);
    try {
      if (callMode === 'view') {
        const result = await octraRpc<unknown>('contract_call', [callAddress, callMethod, params, wallet.address]);
        setCallResult({ result, raw: JSON.stringify(result, null, 2) });
      } else {
        const nonceResult = await octraRpc<{ nonce: number }>('octra_nonce', [wallet.address]);
        const feeResult   = await octraRpc<{ recommended: number }>('octra_recommendedFee', ['contract_call']);
        const txNonce     = nonceResult.nonce + 1;
        const timestamp   = Date.now() / 1000;
        const amountRaw   = Math.round(parseFloat(callAmount || '0') * 1_000_000);

        // canonical order: from, to_, amount, nonce, ou, timestamp, op_type, encrypted_data, [message]
        const canonicalFields: Record<string, unknown> = {
          from:           wallet.address,
          to_:            callAddress,
          amount:         amountRaw.toString(),
          nonce:          txNonce,
          ou:             feeResult.recommended.toString(),
          timestamp,
          op_type:        'call',
          encrypted_data: callMethod,
        };
        const paramsStr = JSON.stringify(params);
        if (paramsStr !== '[]') canonicalFields.message = paramsStr;

        const { signature, public_key } = signTx(canonicalFields, wallet.privateKey);

        const submitResult = await octraRpc<{ tx_hash: string; status: string }>('octra_submit', [
          { ...canonicalFields, signature, public_key }
        ]);
        setCallResult({ result: submitResult, raw: JSON.stringify(submitResult, null, 2) });
        toast({ title: 'TX submitted', description: submitResult.tx_hash.slice(0, 20) + '...' });
      }
    } catch (e) {
      setCallError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  }, [callAddress, callMethod, callParams, callAmount, callMode, wallet, toast]);

  // ── Storage ────────────────────────────────────────────────────────────────

  const handleStorageLookup = useCallback(async () => {
    if (!storageAddress || !storageKey) return;
    setStorageLoading(true);
    setStorageResult(null);
    try {
      const result = await octraRpc<{ key: string; value: string }>('octra_contractStorage', [storageAddress, storageKey]);
      setStorageResult(result.value ?? '(empty)');
    } catch (e) {
      setStorageResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStorageLoading(false);
    }
  }, [storageAddress, storageKey]);

  // ── Render — true fullscreen popup (no fixed top offset) ──────────────────

  return (
    <div
      className="fixed inset-0 z-[300] bg-background flex flex-col overflow-hidden"
      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background flex-shrink-0 h-[49px]">
        <div className="flex items-center gap-3">
          <Code2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Dev Tools</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {activeNetwork === 'testnet' ? 'DevNet' : 'Mainnet'}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono hidden sm:block">
            {wallet.address.slice(0, 10)}...{wallet.address.slice(-6)}
          </span>
          <span className="text-[10px] text-muted-foreground hidden sm:block">
            RPC: {getRpcUrl().replace('http://', '').replace('https://', '').split('/')[0]}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="group text-red-500 hover:text-red-600 hover:bg-transparent font-medium h-8"
        >
          <X className="h-4 w-4 mr-1.5 transition group-hover:drop-shadow-[0_0_6px_currentColor]" />
          <span className="transition group-hover:drop-shadow-[0_0_6px_currentColor] text-xs">Exit Dev Tools</span>
        </Button>
      </div>

      {/* Tabs — fill remaining height */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-shrink-0 px-4 pt-2 pb-0 border-b border-border">
          <TabsList className="h-8">
            <TabsTrigger value="editor" className="gap-1 text-xs h-7 px-3">
              <FileCode className="h-3 w-3" />Editor
            </TabsTrigger>
            <TabsTrigger value="deploy" className="gap-1 text-xs h-7 px-3" disabled={!compiled}>
              <Upload className="h-3 w-3" />Deploy
            </TabsTrigger>
            <TabsTrigger value="call" className="gap-1 text-xs h-7 px-3">
              <Terminal className="h-3 w-3" />Call
            </TabsTrigger>
            <TabsTrigger value="storage" className="gap-1 text-xs h-7 px-3">
              <Layers className="h-3 w-3" />Storage
            </TabsTrigger>
            <TabsTrigger value="abi" className="gap-1 text-xs h-7 px-3" disabled={!compiled}>
              <Braces className="h-3 w-3" />ABI
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab panels wrapper — relative container so inactive tabs don't take space */}
        <div className="flex-1 relative min-h-0 overflow-hidden">

        {/* ── Editor ── */}
        <TabsContent value="editor" className="absolute inset-0 flex flex-col overflow-hidden m-0 p-4 data-[state=inactive]:hidden">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <Label className="text-xs text-muted-foreground">AppliedML Source (.aml)</Label>
            <div className="flex items-center gap-2">
              {compiled && (
                <Badge variant="outline" className="text-[10px] text-green-600 border-green-600/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {compiled.instructions} instr
                </Badge>
              )}
              <Button size="sm" onClick={handleCompile} disabled={compiling} className="h-7 text-xs gap-1">
                {compiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {compiling ? 'Compiling...' : 'Compile'}
              </Button>
            </div>
          </div>

          {/* Editor with line numbers */}
          <div className="flex-1 flex border border-border overflow-hidden min-h-0 font-mono text-xs">
            {/* Gutter — mirrors textarea scrollTop */}
            <div
              ref={gutterRef}
              className="select-none bg-muted/30 border-r border-border text-muted-foreground text-right px-2 pt-3 overflow-hidden flex-shrink-0"
              style={{ minWidth: '3rem', lineHeight: '1.6', userSelect: 'none' }}
              aria-hidden
            >
              {(source || '').split('\n').map((_, i) => (
                <div key={i} style={{ lineHeight: '1.6', fontSize: '0.75rem' }}>{i + 1}</div>
              ))}
            </div>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={source}
              onChange={e => setSource(e.target.value)}
              onScroll={e => {
                if (gutterRef.current)
                  gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              className="flex-1 bg-muted/20 p-3 resize-none focus:outline-none focus:border-primary transition-colors text-foreground overflow-auto"
              style={{ lineHeight: '1.6', fontSize: '0.75rem', tabSize: 2 }}
              spellCheck={false}
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const start = el.selectionStart;
                  const end   = el.selectionEnd;
                  const next  = source.slice(0, start) + '  ' + source.slice(end);
                  setSource(next);
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = start + 2;
                  });
                }
              }}
            />
          </div>

          {compileError && (
            <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 text-xs text-destructive font-mono flex-shrink-0">
              <AlertCircle className="h-3 w-3 inline mr-1" />{compileError}
            </div>
          )}
          {compiled && (
            <div className="mt-2 p-2 bg-green-500/10 border border-green-500/30 text-xs text-green-600 dark:text-green-400 flex-shrink-0">
              <CheckCircle2 className="h-3 w-3 inline mr-1" />
              Compiled — {compiled.instructions} instructions, {compiled.size} bytes, v{compiled.version}
            </div>
          )}
        </TabsContent>

        {/* ── Deploy ── */}
        <TabsContent value="deploy" className="absolute inset-0 overflow-auto m-0 data-[state=inactive]:hidden">
          <div className="h-full flex items-center justify-center p-4">
            <div className="max-w-xl w-full space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Constructor Params (JSON array)</Label>
              <Input value={constructorParams} onChange={e => setConstructorParams(e.target.value)}
                placeholder='["TokenName", "TKN", 1000000000000, 6]' className="font-mono text-xs" />
              <p className="text-[10px] text-muted-foreground mt-1">Positional array matching your init() parameters. Use [] if no constructor.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePreviewAddress} disabled={!compiled} className="text-xs h-8">
                <Eye className="h-3 w-3 mr-1" />Preview Address
              </Button>
              <Button size="sm" onClick={handleDeploy} disabled={deploying || !compiled} className="text-xs h-8 gap-1">
                {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {deploying ? 'Deploying...' : 'Deploy'}
              </Button>
            </div>
            {previewAddress && (
              <div className="p-3 bg-muted/30 border border-border text-xs">
                <p className="text-muted-foreground mb-1">Predicted address:</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-primary flex-1 break-all">{previewAddress}</code>
                  <button onClick={() => copyText(previewAddress, 'preview')} className="hover:opacity-70 transition-opacity text-muted-foreground flex-shrink-0">
                    {copied === 'preview' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}
            {deployError && (
              <div className="p-2 bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 inline mr-1" />{deployError}
              </div>
            )}
            {deployed && (
              <div className="p-3 bg-green-500/10 border border-green-500/30 text-xs space-y-2">
                <p className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />Deployed successfully!
                </p>
                <div>
                  <p className="text-muted-foreground mb-0.5">Contract address:</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-primary flex-1 break-all">{deployed.address}</code>
                    <button onClick={() => copyText(deployed.address, 'deployed')} className="hover:opacity-70 transition-opacity text-muted-foreground">
                      {copied === 'deployed' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">TX hash:</p>
                  <code className="font-mono text-xs break-all">{deployed.tx_hash}</code>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { setCallAddress(deployed.address); setActiveTab('call'); }}>
                  <ChevronRight className="h-3 w-3 mr-1" />Go to Call
                </Button>
              </div>
            )}
          </div>
          </div>
        </TabsContent>

        {/* ── Call ── */}
        <TabsContent value="call" className="absolute inset-0 overflow-auto m-0 data-[state=inactive]:hidden">
          <div className="h-full flex items-center justify-center p-4">
            <div className="max-w-xl w-full space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Contract Address</Label>
              <Input value={callAddress} onChange={e => setCallAddress(e.target.value)} placeholder="octXXX..." className="font-mono text-xs" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">Method Name</Label>
                <Input value={callMethod} onChange={e => setCallMethod(e.target.value)} placeholder="transfer" className="font-mono text-xs" />
              </div>
              <div className="w-32">
                <Label className="text-xs text-muted-foreground mb-1 block">Mode</Label>
                <select value={callMode} onChange={e => setCallMode(e.target.value as 'view' | 'send')}
                  className="w-full h-9 px-2 text-xs bg-background border border-input focus:outline-none focus:border-primary">
                  <option value="view">View (read)</option>
                  <option value="send">Send (write)</option>
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Params (JSON array)</Label>
              <Input value={callParams} onChange={e => setCallParams(e.target.value)} placeholder='["addr", 1000]' className="font-mono text-xs" />
            </div>
            {callMode === 'send' && (
              <div className="w-40">
                <Label className="text-xs text-muted-foreground mb-1 block">OCT Amount</Label>
                <Input value={callAmount} onChange={e => setCallAmount(e.target.value)} placeholder="0" type="number" className="font-mono text-xs" />
              </div>
            )}
            <Button size="sm" onClick={handleCall} disabled={calling || !callAddress || !callMethod} className="text-xs h-8 gap-1">
              {calling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {calling ? 'Calling...' : callMode === 'view' ? 'View (read-only)' : 'Send Call TX'}
            </Button>
            {callError && (
              <div className="p-2 bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 inline mr-1" />{callError}
              </div>
            )}
            {callResult && (
              <div className="p-3 bg-muted/30 border border-border">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Result:</p>
                  <button onClick={() => copyText(callResult.raw, 'callresult')} className="hover:opacity-70 transition-opacity text-muted-foreground">
                    {copied === 'callresult' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <pre className="font-mono text-xs text-foreground whitespace-pre-wrap break-all">{callResult.raw}</pre>
              </div>
            )}
          </div>
          </div>
        </TabsContent>

        {/* ── Storage ── */}
        <TabsContent value="storage" className="absolute inset-0 overflow-auto m-0 data-[state=inactive]:hidden">
          <div className="h-full flex items-center justify-center p-4">
            <div className="max-w-xl w-full space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Contract Address</Label>
              <Input value={storageAddress} onChange={e => setStorageAddress(e.target.value)} placeholder="octXXX..." className="font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Storage Key</Label>
              <Input value={storageKey} onChange={e => setStorageKey(e.target.value)} placeholder="balances:octXXX..." className="font-mono text-xs" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Patterns: <code className="font-mono">field</code> · <code className="font-mono">map:key</code> · <code className="font-mono">nested:k1:k2</code>
              </p>
            </div>
            <Button size="sm" onClick={handleStorageLookup} disabled={storageLoading || !storageAddress || !storageKey} className="text-xs h-8 gap-1">
              {storageLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Lookup
            </Button>
            {storageResult !== null && (
              <div className="p-3 bg-muted/30 border border-border">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Value:</p>
                  <button onClick={() => copyText(storageResult, 'storage')} className="hover:opacity-70 transition-opacity text-muted-foreground">
                    {copied === 'storage' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <code className="font-mono text-xs text-foreground break-all">{storageResult}</code>
              </div>
            )}
            </div>
          </div>
        </TabsContent>

        {/* ── ABI ── */}
        <TabsContent value="abi" className="absolute inset-0 overflow-auto m-0 data-[state=inactive]:hidden">
          {compiled && (() => {
            const abi = parseAbi(compiled.abi);
            const fns  = abi.functions ?? [];
            const evts = abi.events    ?? [];
            const abiStr = JSON.stringify(abi, null, 2);
            return (
              <div className="h-full flex items-center justify-center p-4">
              <div className="max-w-xl w-full space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Contract ABI — {fns.length} functions, {evts.length} events
                  </Label>
                  <button onClick={() => copyText(abiStr, 'abi')} className="hover:opacity-70 transition-opacity text-muted-foreground text-xs flex items-center gap-1">
                    {copied === 'abi' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy
                  </button>
                </div>

                {/* Functions */}
                <div className="space-y-1">
                  {fns.map((fn, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted/30 border border-border text-xs">
                      <code className="font-mono text-primary">
                        {fn.name}({formatInputs(fn.inputs ?? [])}): {fn.output}
                      </code>
                      <div className="flex gap-1 ml-2 shrink-0">
                        {fn.view    && <Badge variant="secondary" className="text-[10px]">view</Badge>}
                        {fn.payable && <Badge variant="outline"   className="text-[10px]">payable</Badge>}
                        {!fn.view && !fn.payable && <Badge variant="outline" className="text-[10px]">write</Badge>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Events */}
                {evts.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Events</Label>
                    {evts.map((ev, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted/30 border border-border text-xs">
                        <code className="font-mono text-yellow-600 dark:text-yellow-400">
                          {ev.name}({formatInputs(ev.inputs ?? [])})
                        </code>
                        <Badge variant="outline" className="text-[10px] ml-2 shrink-0">event</Badge>
                      </div>
                    ))}
                  </div>
                )}

                {/* Disassembly */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Disassembly</Label>
                  <pre className="font-mono text-[10px] bg-muted/20 border border-border p-3 overflow-auto max-h-64 text-muted-foreground whitespace-pre">
                    {compiled.disasm}
                  </pre>
                </div>
              </div>
              </div>
            );
          })()}
        </TabsContent>
        </div>{/* end tab panels wrapper */}
      </Tabs>
    </div>
  );
}
