import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  CircleCheckBig,
  CheckCircle,
  XCircle,
  Shield,
  Globe,
  Code,
  Zap,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
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
import { OperationMode } from '../utils/modeStorage';

const PAGE_SIZE = 20;

interface UnifiedHistoryProps {
  wallet: Wallet | null;
  transactions: Transaction[];
  onTransactionsUpdate: (transactions: Transaction[]) => void;
  isLoading?: boolean;
  isPopupMode?: boolean;
  hideBorder?: boolean;
  operationMode?: OperationMode;
}

export function UnifiedHistory({ wallet, transactions, onTransactionsUpdate, isLoading = false, isPopupMode = false, hideBorder = false, operationMode = 'public' }: UnifiedHistoryProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionDetails | PendingTransaction | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [contractHistory, setContractHistory] = useState<ContractInteraction[]>([]);
  const [activeFilter, setActiveFilter] = useState<HistoryFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const historyListRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Filter transactions based on operationMode
  const filteredTransactions = transactions.filter(tx => {
    if (operationMode === 'private') {
      return isPrivateTransfer(tx);
    } else {
      return !isPrivateTransfer(tx);
    }
  });

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

  const fetchTransactions = async (page: number = 1) => {
    if (!wallet) return;
    
    setRefreshing(true);
    
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const result = await getTransactionHistory(wallet.address, { limit: PAGE_SIZE, offset });
      
      const historyData = result.transactions;
      setTotalCount(result.totalCount);
      
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

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    fetchTransactions(newPage);
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

  const getStatusIcon = (status: string, small: boolean = false) => {
    const sizeClass = small ? "h-3 w-3" : "h-4 w-4";
    switch (status) {
      case 'confirmed': return <CircleCheckBig className={`${sizeClass} text-[#0000db] fill-[#0000db]/20`} />;
      case 'pending': return <Clock className={`${sizeClass} text-yellow-500`} />;
      case 'failed': return <XCircle className={`${sizeClass} text-red-500`} />;
      default: return <Clock className={`${sizeClass} text-gray-500`} />;
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

  // Get unified history using filtered transactions (based on operationMode)
  // Don't include contract history in the unified view
  const unifiedHistory = getUnifiedHistory(filteredTransactions, [], activeFilter);
  const pendingCount = filteredTransactions.filter(tx => tx.status === 'pending').length;

  return (
    <Card className={hideBorder || isPopupMode ? 'border-0 shadow-none' : ''}>
      <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${isPopupMode ? 'pb-2 px-3 pt-3' : 'pb-4'}`}>
        <div className="flex flex-col gap-0.5">
          <CardTitle className={`flex items-center gap-2 ${isPopupMode ? 'text-sm' : ''}`}>
            <History className={isPopupMode ? 'h-4 w-4' : 'h-5 w-5'} />
            {operationMode === 'private' ? 'Private History' : 'Public History'}
            {pendingCount > 0 && (
              <Badge variant="secondary" className={isPopupMode ? 'ml-1 text-[10px]' : 'ml-2'}>{pendingCount}</Badge>
            )}
          </CardTitle>
          <span className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
            {isPopupMode 
              ? `${filteredTransactions.length} ${operationMode} tx` 
              : `${filteredTransactions.length} ${operationMode} transactions`
            }
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => { setCurrentPage(1); fetchTransactions(1); }} disabled={refreshing} className={isPopupMode ? 'h-7 px-2' : ''}>
            <RefreshCw className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} ${isPopupMode ? '' : 'mr-2'} ${refreshing ? 'animate-spin' : ''}`} />
            {!isPopupMode && 'Refresh'}
          </Button>
          <Button variant="outline" size="sm" asChild className={isPopupMode ? 'h-7 px-2' : ''}>
            <a href={`https://octrascan.io/addresses/${wallet.address}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className={`${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} ${isPopupMode ? '' : 'mr-2'}`} />
              {!isPopupMode && 'View All'}
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className={isPopupMode ? 'px-3 pb-3 pt-0' : ''}>
        {/* Filter Buttons */}
        <div className={`flex flex-wrap ${isPopupMode ? 'gap-1 mb-2' : 'gap-2 mb-4'}`}>
          {(['all', 'sent', 'received'] as HistoryFilter[]).map((filter) => {
            const sentCount = filteredTransactions.filter(tx => tx.type === 'sent').length;
            const receivedCount = filteredTransactions.filter(tx => tx.type === 'received').length;
            
            return (
              <Button
                key={filter}
                variant={activeFilter === filter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveFilter(filter)}
                className={`capitalize ${isPopupMode ? 'h-6 px-2 text-[10px]' : ''} ${
                  activeFilter === filter && operationMode === 'private' ? 'bg-[#0000db] hover:bg-[#0000db]/90' : ''
                }`}
              >
                {filter}
                {filter === 'sent' && sentCount > 0 && (
                  <Badge variant="secondary" className={isPopupMode ? 'ml-1 text-[9px] px-1' : 'ml-1.5 text-xs'}>{sentCount}</Badge>
                )}
                {filter === 'received' && receivedCount > 0 && (
                  <Badge variant="secondary" className={isPopupMode ? 'ml-1 text-[9px] px-1' : 'ml-1.5 text-xs'}>{receivedCount}</Badge>
                )}
              </Button>
            );
          })}
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
          <ScrollArea className={isPopupMode ? 'h-auto' : 'h-[calc(100vh-450px)] pr-3'}>
            <div ref={historyListRef} className={`${isPopupMode ? 'space-y-2 mb-[110px]' : 'space-y-3 pr-1 pb-4'}`}>
              {unifiedHistory.map((item) => (
                <div key={item.id} className={`border  ${isPopupMode ? 'p-2' : 'p-3'} space-y-2`}>
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
          </ScrollArea>
        )}

        {/* Pagination Controls */}
        {totalCount > PAGE_SIZE && (
          <div className={`flex items-center justify-between ${isPopupMode ? 'mt-2 pt-2' : 'mt-4 pt-4'} border-t`}>
            <div className={`text-muted-foreground ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
              {isPopupMode 
                ? `${currentPage}/${Math.ceil(totalCount / PAGE_SIZE)}`
                : `Page ${currentPage} of ${Math.ceil(totalCount / PAGE_SIZE)} (${totalCount} total)`
              }
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1 || refreshing}
                className={isPopupMode ? 'h-6 w-6 p-0' : 'h-8 px-2'}
              >
                <ChevronLeft className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= Math.ceil(totalCount / PAGE_SIZE) || refreshing}
                className={isPopupMode ? 'h-6 w-6 p-0' : 'h-8 px-2'}
              >
                <ChevronRight className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
              </Button>
            </div>
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
              <DialogDescription className="sr-only">
                View detailed information about this transaction
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto pr-1">
              {loadingDetails ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: '#0000db' }} />
                </div>
              ) : selectedTx ? (
                <div className="space-y-2">
                  {/* Status */}
                  <div className="bg-muted/50  p-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Status</span>
                    {'stage_status' in selectedTx ? (
                      <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-600">
                        {selectedTx.stage_status || 'pending'}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs bg-[#0000db]/20 text-[#0000db]">
                        confirmed
                      </Badge>
                    )}
                  </div>

                  {/* Epoch - only for confirmed */}
                  {'epoch' in selectedTx && (
                    <div className="bg-muted/50  p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Epoch</span>
                      <span className="font-mono text-sm">{selectedTx.epoch}</span>
                    </div>
                  )}

                  {/* Time */}
                  {('timestamp' in selectedTx || 'parsed_tx' in selectedTx) && (
                    <div className="bg-muted/50  p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Time (UTC)</span>
                      <span className="text-sm">
                        {'timestamp' in selectedTx 
                          ? new Date(selectedTx.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
                          : new Date(selectedTx.parsed_tx.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
                        }
                      </span>
                    </div>
                  )}

                  {/* Hash */}
                  <div className="bg-muted/50  p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Hash</span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 w-6 p-0" 
                        onClick={() => copyToClipboard('hash' in selectedTx ? selectedTx.hash : selectedTx.tx_hash, 'Hash')}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="font-mono text-xs break-all">
                      {'hash' in selectedTx ? selectedTx.hash : selectedTx.tx_hash}
                    </p>
                  </div>

                  {/* From - full address */}
                  {('from' in selectedTx || 'parsed_tx' in selectedTx) && (
                    <div className="bg-muted/50  p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">From</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0" 
                          onClick={() => copyToClipboard('from' in selectedTx ? selectedTx.from : selectedTx.parsed_tx.from, 'Address')}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="font-mono text-sm break-all">
                        {'from' in selectedTx ? selectedTx.from : selectedTx.parsed_tx.from}
                      </p>
                    </div>
                  )}

                  {/* To - full address */}
                  {('to' in selectedTx || 'parsed_tx' in selectedTx) && (
                    <div className="bg-muted/50  p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">To</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0" 
                          onClick={() => copyToClipboard('to' in selectedTx ? selectedTx.to : selectedTx.parsed_tx.to, 'Address')}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="font-mono text-sm break-all">
                        {'to' in selectedTx ? selectedTx.to : selectedTx.parsed_tx.to}
                      </p>
                    </div>
                  )}

                  {/* Amount, OU (Gas), Nonce */}
                  <div className="grid grid-cols-3 gap-2">
                    {('amount' in selectedTx || 'parsed_tx' in selectedTx) && (
                      <div className="bg-muted/50  p-3">
                        <span className="text-xs text-muted-foreground">Amount</span>
                        <p className="font-mono text-sm mt-0.5">
                          {'amount' in selectedTx ? selectedTx.amount : selectedTx.parsed_tx.amount} OCT
                        </p>
                      </div>
                    )}
                    {('ou' in selectedTx || 'parsed_tx' in selectedTx) && (() => {
                      const ouValue = 'ou' in selectedTx ? selectedTx.ou : selectedTx.parsed_tx.ou;
                      const ouNum = parseInt(ouValue) || 0;
                      const feeOct = (ouNum * 0.0000001).toFixed(7);
                      return (
                        <div className="bg-muted/50  p-3">
                          <span className="text-xs text-muted-foreground">OU (Gas)</span>
                          <p className="font-mono text-xs mt-0.5">{ouValue}</p>
                          <p className="text-[10px] text-muted-foreground">≈ {feeOct} OCT</p>
                        </div>
                      );
                    })()}
                    {('nonce' in selectedTx || 'parsed_tx' in selectedTx) && (
                      <div className="bg-muted/50  p-3">
                        <span className="text-xs text-muted-foreground">Nonce</span>
                        <p className="font-mono text-sm mt-0.5">
                          {'nonce' in selectedTx ? selectedTx.nonce : selectedTx.parsed_tx.nonce}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* View on Explorer */}
                  <Button
                    variant="outline"
                    className="w-full h-10"
                    asChild
                  >
                    <a 
                      href={`https://octrascan.io/transactions/${'hash' in selectedTx ? selectedTx.hash : selectedTx.tx_hash}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View on Explorer
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-sm">No transaction data available</p>
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
  getStatusIcon: (status: string, small?: boolean) => React.ReactNode;
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
      <div className="relative flex items-center justify-between gap-2">
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
              {getStatusIcon(tx.status, true)}
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
              <a href={`https://octrascan.io/transactions/${tx.hash}`} target="_blank" rel="noopener noreferrer">
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
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {tx.type === 'sent' ? (
            <ArrowUpRight className="h-4 w-4 text-red-500" />
          ) : (
            <ArrowDownLeft className="h-4 w-4 text-green-500" />
          )}
          <span className="font-medium capitalize text-sm">{tx.type}</span>
          {getStatusIcon(tx.status)}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onViewDetails(tx.hash, tx.status === 'pending')}>
            <Eye className="h-4 w-4" />
          </Button>
          {tx.status === 'confirmed' && (
            <Button variant="ghost" size="sm" asChild>
              <a href={`https://octrascan.io/transactions/${tx.hash}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
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
          <span>{new Date(tx.timestamp * 1000).toLocaleString('en-US', { timeZone: 'UTC', hour12: false })} UTC</span>
        </div>
      </div>
    </div>
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
            <a href={`https://octrascan.io/transactions/${contract.txHash}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
    );
  }
  
  // Expanded mode: full view
  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-sm">{contract.methodName}</span>
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
            <a href={`https://octrascan.io/transactions/${contract.txHash}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
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
      {/* Type Badge - Bottom Right */}
      <div className="absolute bottom-0 right-0">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
          <Zap className="h-2.5 w-2.5 mr-0.5" />
          Contract
        </Badge>
      </div>
    </div>
  );
}
