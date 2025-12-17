import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  History, 
  RefreshCw, 
  ExternalLink, 
  ArrowUpRight, 
  ArrowDownLeft,
  Wallet as WalletIcon,
  Eye,
  Copy,
  Clock,
  CheckCircle,
  XCircle,
  Shield,
  Code,
  Zap
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { getTransactionHistory, fetchTransactionDetails, fetchPendingTransactionByHash } from '../utils/api';
import { TransactionDetails, PendingTransaction } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { 
  Transaction, 
  ContractInteraction, 
  HistoryFilter,
  getUnifiedHistory,
  isPrivateTransfer
} from '../utils/historyMerge';

interface UnifiedHistoryProps {
  wallet: Wallet | null;
  transactions: Transaction[];
  onTransactionsUpdate: (transactions: Transaction[]) => void;
  isLoading?: boolean;
  isPopupMode?: boolean;
}

export function UnifiedHistory({ wallet, transactions, onTransactionsUpdate, isLoading = false, isPopupMode = false }: UnifiedHistoryProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionDetails | PendingTransaction | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [contractHistory, setContractHistory] = useState<ContractInteraction[]>([]);
  const [activeFilter, setActiveFilter] = useState<HistoryFilter>('all');
  const { toast } = useToast();

  // Load contract history when wallet changes
  useEffect(() => {
    if (wallet) {
      loadContractHistory();
    }
  }, [wallet]);

  const loadContractHistory = () => {
    if (!wallet) return;
    
    try {
      const history = JSON.parse(localStorage.getItem('contractHistory') || '[]');
      const walletHistory = history.filter((interaction: ContractInteraction) => 
        interaction.walletAddress === wallet.address
      );
      setContractHistory(walletHistory);
    } catch (error) {
      console.error('Failed to load contract history:', error);
      setContractHistory([]);
    }
  };

  const fetchTransactions = async () => {
    if (!wallet) return;
    
    setRefreshing(true);
    
    try {
      const historyData = await getTransactionHistory(wallet.address);
      
      if (!Array.isArray(historyData)) {
        onTransactionsUpdate([]);
        return;
      }
      
      const transformedTxs = historyData.map((tx) => ({
        ...tx,
        type: tx.from?.toLowerCase() === wallet.address.toLowerCase() ? 'sent' : 'received'
      } as Transaction));
      
      onTransactionsUpdate(transformedTxs);
      loadContractHistory();
      
      toast({
        title: "History Updated",
        description: `Loaded ${transformedTxs.length} transactions and ${contractHistory.length} contract interactions`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch history. Check RPC connection.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const fetchTxDetails = async (hash: string, isPending: boolean = false) => {
    setLoadingDetails(true);
    setShowDetailsDialog(true);
    try {
      if (isPending) {
        const pendingTx = await fetchPendingTransactionByHash(hash);
        setSelectedTx(pendingTx || null);
      } else {
        const details = await fetchTransactionDetails(hash);
        setSelectedTx(details);
      }
    } catch (error) {
      toast({ title: "Error", description: "Fetch failed", variant: "destructive" });
      setShowDetailsDialog(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: `${label} copied to clipboard` });
    } catch (error) {
      toast({ title: "Error", description: "Copy failed", variant: "destructive" });
    }
  };

  const truncateHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  const truncateAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'pending': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'default';
      case 'pending': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'secondary';
    }
  };

  if (!wallet) {
    return (
      <Alert>
        <WalletIcon className="h-4 w-4" />
        <AlertDescription>No wallet available.</AlertDescription>
      </Alert>
    );
  }

  // Get unified history
  const unifiedHistory = getUnifiedHistory(transactions, contractHistory, activeFilter);
  const pendingCount = transactions.filter(tx => tx.status === 'pending').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          History
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">{pendingCount} pending</Badge>
          )}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={fetchTransactions} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {/* Filter Buttons */}
        <div className="flex gap-2 mb-4">
          {(['all', 'transfers', 'contracts'] as HistoryFilter[]).map((filter) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter(filter)}
              className="capitalize"
            >
              {filter}
              {filter === 'transfers' && transactions.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">{transactions.length}</Badge>
              )}
              {filter === 'contracts' && contractHistory.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">{contractHistory.length}</Badge>
              )}
            </Button>
          ))}
        </div>

        {/* History List */}
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : unifiedHistory.length === 0 ? (
          <Alert>
            <AlertDescription>No history found for this filter.</AlertDescription>
          </Alert>
        ) : (
          <div className={`${isPopupMode ? 'space-y-2' : 'space-y-3'}`}>
            {unifiedHistory.map((item) => (
              <div key={item.id} className={`border rounded-lg ${isPopupMode ? 'p-2' : 'p-3'} space-y-2`}>
                {item.type === 'transfer' && item.transaction && (
                  <TransferItem 
                    tx={item.transaction} 
                    onViewDetails={fetchTxDetails}
                    truncateHash={truncateHash}
                    truncateAddress={truncateAddress}
                    getStatusIcon={getStatusIcon}
                    getStatusColor={getStatusColor}
                    copyToClipboard={copyToClipboard}
                    isPopupMode={isPopupMode}
                  />
                )}
                {item.type === 'contract' && item.contractInteraction && (
                  <ContractItem 
                    contract={item.contractInteraction}
                    truncateAddress={truncateAddress}
                    copyToClipboard={copyToClipboard}
                    isPopupMode={isPopupMode}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Transaction Details Dialog */}
        <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
          <DialogContent className="w-[95vw] max-w-md sm:max-w-lg mx-auto max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader className="pb-2">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Eye className="h-4 w-4" />
                Transaction Details
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto pr-1">
              {loadingDetails ? (
                <div className="space-y-4 py-4">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-32 w-full rounded-lg" />
                </div>
              ) : selectedTx ? (
                <div className="space-y-3">
                  {/* Transaction Info Cards */}
                  <div className="grid gap-2">
                    {/* Hash */}
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transaction Hash</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0 hover:bg-background" 
                          onClick={() => copyToClipboard('hash' in selectedTx ? selectedTx.hash : selectedTx.tx_hash, 'Hash')}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="font-mono text-xs break-all leading-relaxed">
                        {'hash' in selectedTx ? selectedTx.hash : selectedTx.tx_hash}
                      </p>
                    </div>

                    {/* From & To */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {/* From */}
                      {('from' in selectedTx || 'parsed_tx' in selectedTx) && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</span>
                          <p className="font-mono text-xs break-all mt-1 leading-relaxed">
                            {'from' in selectedTx ? selectedTx.from : selectedTx.parsed_tx.from}
                          </p>
                        </div>
                      )}
                      {/* To */}
                      {('to' in selectedTx || 'parsed_tx' in selectedTx) && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</span>
                          <p className="font-mono text-xs break-all mt-1 leading-relaxed">
                            {'to' in selectedTx ? selectedTx.to : selectedTx.parsed_tx.to}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Amount, Status, Time */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {/* Amount */}
                      {('amount' in selectedTx || 'parsed_tx' in selectedTx) && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</span>
                          <p className="font-mono text-sm font-semibold mt-1">
                            {'amount' in selectedTx ? selectedTx.amount : selectedTx.parsed_tx.amount} OCT
                          </p>
                        </div>
                      )}
                      {/* Status */}
                      {'stage_status' in selectedTx && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</span>
                          <div className="mt-1">
                            <Badge variant="secondary" className="text-xs">{selectedTx.stage_status}</Badge>
                          </div>
                        </div>
                      )}
                      {/* Epoch */}
                      {'epoch' in selectedTx && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Epoch</span>
                          <p className="font-mono text-sm mt-1">{selectedTx.epoch}</p>
                        </div>
                      )}
                      {/* Timestamp */}
                      {('timestamp' in selectedTx || 'parsed_tx' in selectedTx) && (
                        <div className="bg-muted/50 rounded-lg p-3 col-span-2 sm:col-span-1">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</span>
                          <p className="text-xs mt-1">
                            {'timestamp' in selectedTx 
                              ? new Date(selectedTx.timestamp * 1000).toLocaleString()
                              : new Date(selectedTx.parsed_tx.timestamp * 1000).toLocaleString()
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Raw Data Section */}
                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Raw Data</span>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 px-2 text-xs"
                        onClick={() => copyToClipboard(JSON.stringify(selectedTx, null, 2), 'Raw data')}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy JSON
                      </Button>
                    </div>
                    <div className="bg-slate-950 dark:bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
                      <pre className="text-[11px] sm:text-xs p-3 overflow-auto max-h-[180px] text-slate-300 font-mono leading-relaxed whitespace-pre-wrap break-words">
{JSON.stringify(selectedTx, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <XCircle className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No transaction data available</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}


// Transfer Item Sub-component
interface TransferItemProps {
  tx: Transaction;
  onViewDetails: (hash: string, isPending: boolean) => void;
  truncateHash: (hash: string) => string;
  truncateAddress: (address: string) => string;
  getStatusIcon: (status: string) => React.ReactNode;
  getStatusColor: (status: string) => string;
  copyToClipboard: (text: string, label: string) => void;
  isPopupMode?: boolean;
}

function TransferItem({ 
  tx, 
  onViewDetails, 
  truncateHash, 
  truncateAddress, 
  getStatusIcon, 
  getStatusColor,
  copyToClipboard,
  isPopupMode = false
}: TransferItemProps) {
  const isPrivate = isPrivateTransfer(tx);
  
  // Popup mode: simplified compact view
  if (isPopupMode) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {tx.type === 'sent' ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
          ) : (
            <ArrowDownLeft className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {isPrivate ? (
                <span className="text-[#0000db] font-medium text-xs">Private</span>
              ) : (
                <span className="font-mono text-xs truncate">{tx.amount?.toFixed(4) || '0'} OCT</span>
              )}
              {getStatusIcon(tx.status)}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {tx.type === 'sent' ? 'To: ' : 'From: '}{truncateAddress(tx.type === 'sent' ? tx.to : tx.from)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onViewDetails(tx.hash, tx.status === 'pending')}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {tx.status === 'confirmed' && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <a href={`https://octrascan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }
  
  // Expanded mode: full view
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {tx.type === 'sent' ? (
            <ArrowUpRight className="h-4 w-4 text-red-500" />
          ) : (
            <ArrowDownLeft className="h-4 w-4 text-green-500" />
          )}
          <span className="font-medium capitalize text-sm">{tx.type}</span>
          
          {/* Type Badge */}
          {isPrivate ? (
            <Badge className="bg-[#0000db] text-white text-xs">
              <Shield className="h-3 w-3 mr-1" />
              Private
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              <ArrowUpRight className="h-3 w-3 mr-1" />
              Transfer
            </Badge>
          )}
          
          <div className="flex items-center gap-1">
            {getStatusIcon(tx.status)}
            <Badge variant={getStatusColor(tx.status) as any} className="text-xs">
              {tx.status}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onViewDetails(tx.hash, tx.status === 'pending')}>
            <Eye className="h-4 w-4" />
          </Button>
          {tx.status === 'confirmed' && (
            <Button variant="ghost" size="sm" asChild>
              <a href={`https://octrascan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Amount: </span>
          {isPrivate ? (
            <span className="text-[#0000db] font-medium">private OCT</span>
          ) : (
            <span className="font-mono">{tx.amount?.toFixed(8) || '0'} OCT</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Hash: </span>
          <span className="font-mono">{truncateHash(tx.hash || 'N/A')}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{tx.type === 'sent' ? 'To: ' : 'From: '}</span>
          <span className="font-mono">{truncateAddress(tx.type === 'sent' ? tx.to : tx.from)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Time: </span>
          <span>{new Date(tx.timestamp * 1000).toLocaleString()}</span>
        </div>
      </div>
    </>
  );
}

// Contract Item Sub-component
interface ContractItemProps {
  contract: ContractInteraction;
  truncateAddress: (address: string) => string;
  copyToClipboard: (text: string, label: string) => void;
  isPopupMode?: boolean;
}

function ContractItem({ contract, truncateAddress, copyToClipboard, isPopupMode = false }: ContractItemProps) {
  // Popup mode: simplified compact view
  if (isPopupMode) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Code className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-xs truncate">{contract.methodName}</span>
              {contract.success ? (
                <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
              ) : (
                <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
              )}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {truncateAddress(contract.contractAddress)}
            </div>
          </div>
        </div>
        {contract.txHash && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" asChild>
            <a href={`https://octrascan.io/tx/${contract.txHash}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
    );
  }
  
  // Expanded mode: full view
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-sm">{contract.methodName}</span>
          
          {/* Type Badge */}
          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
            <Zap className="h-3 w-3 mr-1" />
            Contract
          </Badge>
          
          <Badge variant={contract.type === 'view' ? 'secondary' : 'default'} className="text-xs">
            {contract.type}
          </Badge>
          
          {contract.success ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
        </div>
        {contract.txHash && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`https://octrascan.io/tx/${contract.txHash}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Contract: </span>
          <span className="font-mono">{truncateAddress(contract.contractAddress)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Time: </span>
          <span>{new Date(contract.timestamp).toLocaleString()}</span>
        </div>
        {contract.error && (
          <div className="col-span-2 text-red-500">
            <span className="text-muted-foreground">Error: </span>
            {contract.error}
          </div>
        )}
      </div>
    </>
  );
}
