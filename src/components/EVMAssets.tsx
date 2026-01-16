/**
 * EVMAssets - Full screen modal for EVM Assets management
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea, ScrollAreaContent } from '@/components/ui/scroll-area';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Copy, Check, Wallet as WalletIcon, RefreshCw, Send, ExternalLink,
  Wifi, WifiOff, Loader2, AlertCircle, Coins, X,
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { getEVMWalletData, EVMWalletData } from '../utils/evmDerive';
import {
  getEVMBalance, DEFAULT_EVM_NETWORKS, EVMNetwork, getActiveEVMNetwork,
  setActiveEVMNetwork, checkEVMRpcStatus, getEVMRpcUrl, saveEVMProvider,
  getEVMGasPrice, getRpcDisplayName, sendEVMTransaction, getEVMTransactions, EVMTransaction,
  getUSDTBalance, getUSDTTransactions, getETHPrice, calculateUSDValue,
} from '../utils/evmRpc';
import { useToast } from '@/hooks/use-toast';
import { WalletDisplayName } from './WalletLabelEditor';

interface EVMAssetsProps {
  wallets: Wallet[];
  activeWallet: Wallet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchWallet: (wallet: Wallet) => void;
}

interface EVMWalletWithBalance extends EVMWalletData {
  balance: string | null;
  isLoading: boolean;
}

export function EVMAssets({ wallets, activeWallet, open, onOpenChange, onSwitchWallet }: EVMAssetsProps) {
  const [evmWallets, setEvmWallets] = useState<EVMWalletWithBalance[]>([]);
  const [selectedEVMWallet, setSelectedEVMWallet] = useState<EVMWalletWithBalance | null>(null);
  const [activeNetwork, setActiveNetwork] = useState<EVMNetwork>(getActiveEVMNetwork());
  const [rpcStatus, setRpcStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [showRPCManager, setShowRPCManager] = useState(false);
  const [customRpcUrl, setCustomRpcUrl] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [gasPrice, setGasPrice] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<EVMTransaction[]>([]);
  const [isLoadingTxs, setIsLoadingTxs] = useState(false);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);
  const [isLoadingUsdt, setIsLoadingUsdt] = useState(false);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setIsInitialized(false);
      return;
    }
    const derived = wallets.map((w) => {
      const evmData = getEVMWalletData(w.address, w.privateKey);
      return { ...evmData, balance: null, isLoading: false };
    });
    setEvmWallets(derived);
    
    // Only update selectedEVMWallet if address changed (avoid unnecessary re-renders)
    const activeEVM = derived.find((e) => e.octraAddress === activeWallet.address);
    const targetWallet = activeEVM || (derived.length > 0 ? derived[0] : null);
    
    if (targetWallet && targetWallet.evmAddress !== selectedEVMWallet?.evmAddress) {
      setSelectedEVMWallet(targetWallet);
      setTransactions([]); // Reset transactions only when wallet actually changes
      setUsdtBalance(null);
    }
    
    setIsInitialized(true);
  }, [wallets, activeWallet, open, selectedEVMWallet?.evmAddress]);

  const checkRpcStatus = useCallback(async () => {
    setRpcStatus('checking');
    try {
      const isConnected = await checkEVMRpcStatus(activeNetwork.id);
      setRpcStatus(isConnected ? 'connected' : 'disconnected');
      if (isConnected) {
        const price = await getEVMGasPrice(activeNetwork.id);
        setGasPrice(price);
      }
    } catch {
      setRpcStatus('disconnected');
    }
  }, [activeNetwork.id]);

  useEffect(() => {
    if (open && isInitialized) checkRpcStatus();
  }, [open, isInitialized, activeNetwork.id, checkRpcStatus]);

  // Fetch ETH price when modal opens
  useEffect(() => {
    if (open) {
      getETHPrice().then(setEthPrice);
    }
  }, [open]);

  const fetchSelectedWalletBalance = useCallback(async () => {
    if (!selectedEVMWallet || rpcStatus !== 'connected') return;
    setEvmWallets((prev) => prev.map((w) => w.evmAddress === selectedEVMWallet.evmAddress ? { ...w, isLoading: true } : w));
    setSelectedEVMWallet((prev) => (prev ? { ...prev, isLoading: true } : null));
    setIsLoadingUsdt(true);
    try {
      const [balance, usdt] = await Promise.all([
        getEVMBalance(selectedEVMWallet.evmAddress, activeNetwork.id),
        getUSDTBalance(selectedEVMWallet.evmAddress, activeNetwork.id),
      ]);
      setEvmWallets((prev) => prev.map((w) => w.evmAddress === selectedEVMWallet.evmAddress ? { ...w, balance, isLoading: false } : w));
      setSelectedEVMWallet((prev) => (prev ? { ...prev, balance, isLoading: false } : null));
      setUsdtBalance(usdt);
    } catch {
      setEvmWallets((prev) => prev.map((w) => w.evmAddress === selectedEVMWallet.evmAddress ? { ...w, balance: '0.000000', isLoading: false } : w));
      setSelectedEVMWallet((prev) => (prev ? { ...prev, balance: '0.000000', isLoading: false } : null));
      setUsdtBalance('0.000000');
    } finally {
      setIsLoadingUsdt(false);
    }
  }, [selectedEVMWallet?.evmAddress, activeNetwork.id, rpcStatus]);

  const fetchTransactions = useCallback(async () => {
    if (!selectedEVMWallet) return;
    setIsLoadingTxs(true);
    try {
      // Fetch both ETH and USDT transactions
      const [ethTxs, usdtTxs] = await Promise.all([
        getEVMTransactions(selectedEVMWallet.evmAddress, activeNetwork.id),
        getUSDTTransactions(selectedEVMWallet.evmAddress, activeNetwork.id),
      ]);
      
      // Merge and sort by timestamp
      const allTxs = [...ethTxs, ...usdtTxs].sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(allTxs);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      setTransactions([]);
    } finally {
      setIsLoadingTxs(false);
    }
  }, [selectedEVMWallet?.evmAddress, activeNetwork.id]);

  // Effect for fetching data when wallet changes
  useEffect(() => {
    if (!open || !isInitialized || !selectedEVMWallet) return;
    
    // Fetch balance if RPC is connected
    if (rpcStatus === 'connected') {
      fetchSelectedWalletBalance();
    }
    
    // Always fetch transactions
    fetchTransactions();
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isInitialized, selectedEVMWallet?.evmAddress, activeNetwork.id]);

  // Effect for fetching balance when RPC status becomes connected
  useEffect(() => {
    if (!open || !isInitialized || !selectedEVMWallet) return;
    
    // Fetch balance when RPC becomes connected
    if (rpcStatus === 'connected' && selectedEVMWallet.balance === null) {
      fetchSelectedWalletBalance();
    }
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcStatus]);

  const refreshAllBalances = useCallback(async () => {
    if (rpcStatus !== 'connected') return;
    setIsRefreshing(true);
    const updatedWallets = await Promise.all(evmWallets.map(async (w) => {
      try {
        const balance = await getEVMBalance(w.evmAddress, activeNetwork.id);
        return { ...w, balance, isLoading: false };
      } catch {
        return { ...w, balance: '0.000000', isLoading: false };
      }
    }));
    setEvmWallets(updatedWallets);
    if (selectedEVMWallet) {
      const updated = updatedWallets.find((w) => w.evmAddress === selectedEVMWallet.evmAddress);
      if (updated) setSelectedEVMWallet(updated);
    }
    setIsRefreshing(false);
  }, [evmWallets, activeNetwork.id, selectedEVMWallet?.evmAddress, rpcStatus]);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast({ title: 'Copied!', description: 'Copied to clipboard' });
    } catch {
      toast({ title: 'Error', description: 'Failed to copy', variant: 'destructive' });
    }
  };

  const handleNetworkChange = (networkId: string) => {
    const network = DEFAULT_EVM_NETWORKS.find((n) => n.id === networkId);
    if (network) {
      setActiveNetwork(network);
      setActiveEVMNetwork(networkId);
      setEvmWallets((prev) => prev.map((w) => ({ ...w, balance: null, isLoading: false })));
      if (selectedEVMWallet) setSelectedEVMWallet({ ...selectedEVMWallet, balance: null, isLoading: false });
      setUsdtBalance(null);
    }
  };

  const handleSaveCustomRpc = () => {
    if (customRpcUrl.trim()) {
      saveEVMProvider(activeNetwork.id, customRpcUrl.trim());
      setShowRPCManager(false);
      setCustomRpcUrl('');
      checkRpcStatus();
      toast({ title: 'Saved', description: 'Custom RPC URL saved' });
    }
  };

  const handleSelectWallet = (evmWallet: EVMWalletWithBalance) => {
    setSelectedEVMWallet(evmWallet);
    setTransactions([]);
    setUsdtBalance(null);
    const octraWallet = wallets.find((w) => w.address === evmWallet.octraAddress);
    if (octraWallet) onSwitchWallet(octraWallet);
  };

  const handleSendTransaction = async () => {
    if (!selectedEVMWallet || !sendTo || !sendAmount) {
      setSendError('Please fill all fields');
      return;
    }
    setSendError(null);
    setIsSending(true);
    setTxHash(null);
    try {
      const hash = await sendEVMTransaction(selectedEVMWallet.privateKeyHex, sendTo, sendAmount, activeNetwork.id);
      setTxHash(hash);
      toast({ title: 'Success!', description: 'Transaction sent successfully' });
      setSendTo('');
      setSendAmount('');
      await fetchSelectedWalletBalance();
      await fetchTransactions();
    } catch (error: any) {
      setSendError(error.message || 'Transaction failed');
      toast({ title: 'Error', description: error.message || 'Transaction failed', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const truncateAddress = (address: string) => `${address.slice(0, 8)}...${address.slice(-6)}`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-none w-screen p-0 gap-0 flex flex-col rounded-none border-none overflow-hidden [&>button]:hidden" style={{ height: 'calc(100vh - 40px)', maxHeight: 'calc(100vh - 40px)' }}>
          <VisuallyHidden>
            <DialogTitle>EVM Assets Management</DialogTitle>
            <DialogDescription>Manage your Ethereum and ERC20 tokens</DialogDescription>
          </VisuallyHidden>
          
          {/* Header with Close Button */}
          <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0 bg-background">
            <div className="flex items-center gap-3">
              <Coins className="h-6 w-6 text-orange-500" />
              <div>
                <h2 className="text-xl font-semibold">EVM Assets</h2>
                <p className="text-sm text-muted-foreground">Manage ETH & ERC20 tokens</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Select value={activeNetwork.id} onValueChange={handleNetworkChange}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="eth-mainnet">Ethereum Mainnet</SelectItem>
                  <SelectItem value="eth-sepolia">Sepolia Testnet</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={() => setShowRPCManager(true)} className="gap-2">
                {rpcStatus === 'connected' ? <Wifi className="h-4 w-4 text-green-500" /> : 
                 rpcStatus === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : 
                 <WifiOff className="h-4 w-4 text-red-500" />}
                <span className="text-xs">{getRpcDisplayName(getEVMRpcUrl(activeNetwork.id))}</span>
              </Button>

              <Button variant="outline" size="sm" onClick={refreshAllBalances} disabled={isRefreshing || rpcStatus !== 'connected'}>
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>

              <div className="h-8 w-px bg-border mx-2" />

              <Button variant="destructive" size="sm" onClick={() => onOpenChange(false)} className="gap-2">
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>
          </div>

          {/* Main Content - No Scroll */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel */}
            <div className="w-80 flex flex-col bg-muted/30 overflow-hidden">
              <div className="p-4">
                <h3 className="text-sm font-medium">EVM Wallets ({evmWallets.length})</h3>
              </div>
              <ScrollArea className="flex-1">
                <ScrollAreaContent className="p-3 space-y-2">
                  {evmWallets.map((evmWallet, index) => (
                    <div key={evmWallet.evmAddress} className={`p-4 rounded-lg cursor-pointer transition-all ${
                      selectedEVMWallet?.evmAddress === evmWallet.evmAddress
                        ? 'bg-orange-500/10 border-2 border-orange-500/40 shadow-sm'
                        : 'bg-background hover:bg-muted/80 border border-border'
                    }`} onClick={() => handleSelectWallet(evmWallet)}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px] px-1.5">#{index + 1}</Badge>
                          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                            <WalletDisplayName address={evmWallet.octraAddress} />
                          </span>
                        </div>
                      </div>
                      <p className="font-mono text-sm text-orange-600 dark:text-orange-400 mb-2">
                        {truncateAddress(evmWallet.evmAddress)}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-semibold">
                          {evmWallet.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 
                           evmWallet.balance !== null ? (
                            <div className="flex flex-col">
                              <span>{evmWallet.balance} {activeNetwork.symbol}</span>
                              {ethPrice !== null && (
                                <span className="text-xs text-muted-foreground">
                                  ≈ {calculateUSDValue(evmWallet.balance, ethPrice)}
                                </span>
                              )}
                            </div>
                          ) : 
                           <span className="text-muted-foreground text-sm">--</span>}
                        </span>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(evmWallet.evmAddress, `evm-${index}`);
                        }}>
                          {copiedField === `evm-${index}` ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </ScrollAreaContent>
              </ScrollArea>
            </div>

            {/* Separator */}
            <div className="w-px bg-border flex-shrink-0" />

            {/* Center Panel - No Scroll, Fit Height */}
            <div className="flex-1 flex flex-col p-6 gap-4 overflow-hidden">
              {selectedEVMWallet ? (
                <>
                  {/* Card 1: Balance - Larger */}
                  <Card className="flex-1 flex flex-col overflow-hidden">
                    <CardContent className="pt-6 pb-6 flex flex-col h-full">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-baseline gap-3">
                          {selectedEVMWallet.isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : 
                           selectedEVMWallet.balance !== null ? (
                            <>
                              <span className="text-5xl font-bold">{selectedEVMWallet.balance}</span>
                              <span className="text-2xl text-muted-foreground">{activeNetwork.symbol}</span>
                            </>
                          ) : <span className="text-xl text-muted-foreground">{rpcStatus === 'connected' ? 'Loading...' : 'RPC Disconnected'}</span>}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={fetchSelectedWalletBalance} 
                          disabled={selectedEVMWallet.isLoading || rpcStatus !== 'connected'}
                          className="h-10 w-10"
                        >
                          <RefreshCw className={`h-5 w-5 ${selectedEVMWallet.isLoading ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>

                      {/* USD Estimation */}
                      {selectedEVMWallet.balance !== null && ethPrice !== null && (
                        <div className="text-lg text-muted-foreground">
                          ≈ {calculateUSDValue(selectedEVMWallet.balance, ethPrice)}
                          {activeNetwork.isTestnet && <span className="text-xs ml-2">(testnet - no real value)</span>}
                        </div>
                      )}

                      <div className="space-y-4 flex-1">
                        <div className="space-y-2">
                          <Label className="text-sm text-muted-foreground font-medium">EVM Address</Label>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-base font-mono bg-muted px-3 py-2.5 rounded break-all">
                              {selectedEVMWallet.evmAddress}
                            </code>
                            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => copyToClipboard(selectedEVMWallet.evmAddress, 'main-evm')}>
                              {copiedField === 'main-evm' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </Button>
                            <Button variant="outline" size="icon" className="h-9 w-9" asChild>
                              <a href={`${activeNetwork.explorer}/address/${selectedEVMWallet.evmAddress}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm text-muted-foreground font-medium">Linked Octra</Label>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-base font-mono bg-muted/50 px-3 py-2.5 rounded text-muted-foreground break-all">
                              {selectedEVMWallet.octraAddress}
                            </code>
                            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => copyToClipboard(selectedEVMWallet.octraAddress, 'octra')}>
                              {copiedField === 'octra' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Button Send */}
                  <Button variant="outline" className="w-full h-14 flex items-center justify-center gap-3 border-orange-500/30 hover:bg-orange-500/10 hover:border-orange-500/50 flex-shrink-0"
                    onClick={() => setShowSendDialog(true)} disabled={rpcStatus !== 'connected'}>
                    <Send className="h-5 w-5 text-orange-500" />
                    <span className="text-base font-medium">Send {activeNetwork.symbol}</span>
                  </Button>

                  {/* Card USDT ERC20 Token - Smaller, Fixed Height */}
                  <Card className="flex-shrink-0">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Coins className="h-4 w-4" />
                        USDT ERC20 Token
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      {isLoadingUsdt ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : usdtBalance && parseFloat(usdtBalance) > 0 ? (
                        <div className="p-2 bg-muted/50 rounded-lg border border-border hover:border-orange-500/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center">
                                <span className="text-xs font-bold text-green-600">₮</span>
                              </div>
                              <div>
                                <p className="text-sm font-semibold">Tether USD</p>
                                <p className="text-xs text-muted-foreground">USDT</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{usdtBalance}</p>
                              <p className="text-xs text-muted-foreground">USDT</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center py-4 text-center text-muted-foreground">
                          <div>
                            <Coins className="h-8 w-8 mx-auto mb-2 opacity-20" />
                            <p className="text-xs">No USDT tokens</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {gasPrice && (
                    <div className="text-center text-xs text-muted-foreground flex-shrink-0">
                      Gas: <span className="font-medium">{gasPrice} Gwei</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <WalletIcon className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg">Select a wallet to view EVM assets</p>
                  </div>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="w-px bg-border flex-shrink-0" />

            {/* Right Panel - Transaction History */}
            <div className="w-80 flex flex-col bg-muted/30 overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Transaction History</h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={fetchTransactions} 
                  disabled={isLoadingTxs || !selectedEVMWallet}
                  className="h-7 w-7 p-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingTxs ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <ScrollAreaContent className="p-3">
                  {isLoadingTxs ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : transactions.length > 0 ? (
                    <div className="space-y-2">
                      {transactions.map((tx) => (
                        <div key={tx.hash} className="p-3 bg-background rounded-lg border border-border hover:border-orange-500/30 transition-colors">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {tx.type === 'sent' ? (
                                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                                  <Send className="h-4 w-4 text-red-500" />
                                </div>
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                                  <Send className="h-4 w-4 text-green-500 rotate-180" />
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-medium capitalize">{tx.type}</p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(tx.timestamp).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <p className={`text-sm font-semibold ${tx.type === 'sent' ? 'text-red-500' : 'text-green-500'}`}>
                              {tx.type === 'sent' ? '-' : '+'}{tx.value} {activeNetwork.symbol}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs font-mono text-muted-foreground truncate">
                              {tx.hash}
                            </code>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" asChild>
                              <a href={`${activeNetwork.explorer}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-center text-muted-foreground">
                        <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No transactions found</p>
                        {selectedEVMWallet && (
                          <Button variant="link" size="sm" className="mt-4" asChild>
                            <a href={`${activeNetwork.explorer}/address/${selectedEVMWallet.evmAddress}`} target="_blank" rel="noopener noreferrer">
                              View on Explorer <ExternalLink className="h-3 w-3 ml-1" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </ScrollAreaContent>
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* RPC Manager Dialog */}
      <Dialog open={showRPCManager} onOpenChange={setShowRPCManager}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>RPC Settings - {activeNetwork.name}</DialogTitle>
            <DialogDescription>Configure custom RPC endpoint</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current RPC</Label>
              <div className="flex items-center gap-2 bg-muted p-3 rounded">
                <Wifi className={`h-4 w-4 ${rpcStatus === 'connected' ? 'text-green-500' : 'text-red-500'}`} />
                <span className="text-sm font-mono">{getRpcDisplayName(getEVMRpcUrl(activeNetwork.id))}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Custom RPC URL (optional)</Label>
              <Input placeholder="https://your-rpc-endpoint.com" value={customRpcUrl} onChange={(e) => setCustomRpcUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave empty to use default Infura endpoint</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Status:</span>
              {rpcStatus === 'connected' ? <Badge className="bg-green-500">Connected</Badge> : 
               rpcStatus === 'checking' ? <Badge variant="secondary">Checking...</Badge> : 
               <Badge variant="destructive">Disconnected</Badge>}
              <Button variant="ghost" size="sm" onClick={checkRpcStatus}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRPCManager(false)}>Cancel</Button>
            <Button onClick={handleSaveCustomRpc} disabled={!customRpcUrl.trim()}>Save Custom RPC</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Transaction Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send {activeNetwork.symbol}</DialogTitle>
            <DialogDescription>Send {activeNetwork.symbol} from your EVM wallet</DialogDescription>
          </DialogHeader>
          
          {!txHash ? (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Recipient Address</Label>
                <Input placeholder="0x..." value={sendTo} onChange={(e) => setSendTo(e.target.value)} disabled={isSending} />
              </div>
              <div className="space-y-2">
                <Label>Amount ({activeNetwork.symbol})</Label>
                <Input type="number" step="0.000001" placeholder="0.0" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} disabled={isSending} />
              </div>
              {sendError && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
                  {sendError}
                </div>
              )}
              {selectedEVMWallet && selectedEVMWallet.balance && (
                <div className="text-sm text-muted-foreground">
                  Available: {selectedEVMWallet.balance} {activeNetwork.symbol}
                </div>
              )}
              {gasPrice && (
                <div className="text-xs text-muted-foreground">
                  Estimated Gas: ~{gasPrice} Gwei
                </div>
              )}
            </div>
          ) : (
            <div className="py-6">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-10 w-10 text-green-500" />
              </div>
              <p className="text-xl font-semibold mb-2 text-center">Transaction Sent!</p>
              <p className="text-sm text-muted-foreground mb-6 text-center">Your transaction has been broadcast to the network</p>
              <div className="space-y-3">
                <div className="space-y-2 bg-muted p-4 rounded-lg">
                  <Label className="text-xs text-muted-foreground">Transaction Hash</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono break-all">{txHash}</code>
                    <Button variant="ghost" size="sm" className="flex-shrink-0" onClick={() => copyToClipboard(txHash!, 'txhash')}>
                      {copiedField === 'txhash' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <Button variant="outline" className="w-full" asChild>
                  <a href={`${activeNetwork.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View on {activeNetwork.isTestnet ? 'Sepolia ' : ''}Explorer
                  </a>
                </Button>
              </div>
            </div>
          )}
          
          <DialogFooter>
            {!txHash ? (
              <>
                <Button variant="outline" onClick={() => setShowSendDialog(false)} disabled={isSending}>Cancel</Button>
                <Button onClick={handleSendTransaction} disabled={isSending || !sendTo || !sendAmount}>
                  {isSending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : 'Send'}
                </Button>
              </>
            ) : (
              <Button onClick={() => {
                setShowSendDialog(false);
                setTxHash(null);
                setSendTo('');
                setSendAmount('');
              }}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
