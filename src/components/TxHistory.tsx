import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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
  Send,
  Zap
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { getTransactionHistory, fetchTransactionDetails, fetchPendingTransactionByHash } from '../utils/api';
import { TransactionDetails, PendingTransaction } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  type: 'sent' | 'received';
  message?: string;
}

interface ContractInteraction {
  type: 'view' | 'call';
  contractAddress: string;
  methodName: string;
  params: string[];
  result?: any;
  txHash?: string;
  error?: string;
  timestamp: number;
  success: boolean;
  walletAddress: string;
}

interface TxHistoryProps {
  wallet: Wallet | null;
  transactions: Transaction[];
  onTransactionsUpdate: (transactions: Transaction[]) => void;
  isLoading?: boolean;
}

export function TxHistory({ wallet, transactions, onTransactionsUpdate, isLoading = false }: TxHistoryProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionDetails | PendingTransaction | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [contractHistory, setContractHistory] = useState<ContractInteraction[]>([]);
  const [activeTab, setActiveTab] = useState('transactions');
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
      // Filter history for current wallet
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
        console.error('Transaction history data is not an array:', historyData);
        onTransactionsUpdate([]);
        return;
      }
      
      // Transform the data to match our interface
      const transformedTxs = historyData.map((tx) => ({
        ...tx,
        type: tx.from?.toLowerCase() === wallet.address.toLowerCase() ? 'sent' : 'received'
      } as Transaction));
      
      onTransactionsUpdate(transformedTxs);
      
      // Also reload contract history
      loadContractHistory();
      
      toast({
        title: "Transactions Updated",
        description: `Loaded ${transformedTxs.length} transactions and ${contractHistory.length} contract interactions`,
      });
      
    } catch (error) {
      console.error('Error fetching transactions:', error);
      toast({
        title: "Error",
        description: "Failed to fetch transactions. Check RPC connection.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const fetchTxDetails = async (hash: string, isPending: boolean = false) => {
    setLoadingDetails(true);
    
    try {
      if (isPending) {
        // For pending transactions, fetch from staging by hash
        const pendingTx = await fetchPendingTransactionByHash(hash);
        if (pendingTx) {
          setSelectedTx(pendingTx);
        } else {
          throw new Error('Pending transaction not found');
        }
      } else {
        // For confirmed transactions, fetch details
        const details = await fetchTransactionDetails(hash);
        setSelectedTx(details);
      }
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      toast({
        title: "Error",
        description: "Fetch failed",
        variant: "destructive",
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const truncateHash = (hash: string) => {
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'default';
      case 'pending':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Copy failed",
        variant: "destructive",
      });
    }
  };

  const isPendingTransaction = (tx: TransactionDetails | PendingTransaction): tx is PendingTransaction => {
    return 'stage_status' in tx;
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

  const pendingCount = transactions.filter(tx => tx.status === 'pending').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          History
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCount}
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTransactions}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="transactions" className="flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4" />
              Transactions
              {transactions.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {transactions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="contracts" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Contracts
              {contractHistory.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {contractHistory.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-4">
            {isLoading ? (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">Loading transactions...</div>
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No transactions found for this wallet.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Recent {transactions.length} transactions
                  {pendingCount > 0 && ` (${pendingCount} pending)`}
                </div>
                {transactions.map((tx, index) => (
                  <div key={tx.hash || index}>
                    <div className="space-y-3">
                      {/* Transaction Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {tx.type === 'sent' ? (
                            <ArrowUpRight className="h-4 w-4 text-red-500" />
                          ) : (
                            <ArrowDownLeft className="h-4 w-4 text-green-500" />
                          )}
                          <span className="font-medium capitalize">{tx.type}</span>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(tx.status)}
                            <Badge variant={getStatusColor(tx.status)} className="text-xs">
                              {tx.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => fetchTxDetails(tx.hash, tx.status === 'pending')}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>Transaction Details</DialogTitle>
                              </DialogHeader>
                              {loadingDetails ? (
                                <div className="space-y-4">
                                  <Skeleton className="h-4 w-full" />
                                  <Skeleton className="h-4 w-3/4" />
                                  <Skeleton className="h-4 w-1/2" />
                                </div>
                              ) : selectedTx ? (
                                <div className="space-y-4">
                                  {isPendingTransaction(selectedTx) ? (
                                    // Pending transaction details
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                      <div>
                                        <span className="font-medium">Hash:</span>
                                        <div className="font-mono text-xs break-all flex items-center gap-2">
                                          {selectedTx.hash}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => copyToClipboard(selectedTx.hash, 'Transaction Hash')}
                                          >
                                            <Copy className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Status:</span>
                                        <div className="flex items-center gap-2">
                                          <Clock className="h-4 w-4 text-yellow-500" />
                                          <span className="capitalize">{selectedTx.stage_status.replace('_', ' ')}</span>
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">From:</span>
                                        <div className="font-mono text-xs break-all">
                                          {selectedTx.from}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">To:</span>
                                        <div className="font-mono text-xs break-all">
                                          {selectedTx.to}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Amount:</span>
                                        <div className="flex items-center gap-2">
                                          {(() => {
                                            const isPrivateTransfer = selectedTx.message === 'PRIVATE_TRANSFER' || 
                                                                     selectedTx.message === '505249564154455f5452414e53464552' ||
                                                                     (selectedTx.amount === '0' && selectedTx.message);
                                            
                                            if (isPrivateTransfer) {
                                              return (
                                                <div className="flex items-center gap-1">
                                                  <Shield className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                                                  <span className="text-purple-600 dark:text-purple-400 font-medium">private OCT</span>
                                                </div>
                                              );
                                            }
                                            
                                            return `${selectedTx.amount} OCT`;
                                          })()}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Priority:</span>
                                        <div className="capitalize">{selectedTx.priority}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Nonce:</span>
                                        <div>{selectedTx.nonce}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">OU:</span>
                                        <div>{selectedTx.ou}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Timestamp:</span>
                                        <div>{new Date(selectedTx.timestamp * 1000).toLocaleString()}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Has Public Key:</span>
                                        <div>{selectedTx.has_public_key ? 'Yes' : 'No'}</div>
                                      </div>
                                      {selectedTx.message && (
                                        <div className="col-span-2">
                                          <span className="font-medium">Message:</span>
                                          <div className="mt-1 p-2 bg-muted rounded text-sm flex items-center gap-2">
                                            {selectedTx.message === 'PRIVATE_TRANSFER' || 
                                             selectedTx.message === '505249564154455f5452414e53464552' ? (
                                              <>
                                                <Shield className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                                <span className="text-purple-600 dark:text-purple-400 font-medium">Private Transfer</span>
                                              </>
                                            ) : (
                                              selectedTx.message
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    // Confirmed transaction details
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                      <div>
                                        <span className="font-medium">Hash:</span>
                                        <div className="font-mono text-xs break-all flex items-center gap-2">
                                          {selectedTx.tx_hash}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => copyToClipboard(selectedTx.tx_hash, 'Transaction Hash')}
                                          >
                                            <Copy className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Epoch:</span>
                                        <div>{selectedTx.epoch}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">From:</span>
                                        <div className="font-mono text-xs break-all">
                                          {selectedTx.parsed_tx.from}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">To:</span>
                                        <div className="font-mono text-xs break-all">
                                          {selectedTx.parsed_tx.to}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Amount:</span>
                                        <div className="flex items-center gap-2">
                                          {(() => {
                                            const isPrivateTransfer = selectedTx.parsed_tx.message === 'PRIVATE_TRANSFER' || 
                                                                     selectedTx.parsed_tx.message === '505249564154455f5452414e53464552' ||
                                                                     (selectedTx.parsed_tx.amount === '0' && selectedTx.parsed_tx.message);
                                            
                                            if (isPrivateTransfer) {
                                              return (
                                                <div className="flex items-center gap-1">
                                                  <Shield className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                                                  <span className="text-purple-600 dark:text-purple-400 font-medium">private OCT</span>
                                                </div>
                                              );
                                            }
                                            
                                            return `${selectedTx.parsed_tx.amount} OCT`;
                                          })()}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Amount Raw:</span>
                                        <div className="flex items-center gap-2">
                                          {(() => {
                                            const isPrivateTransfer = selectedTx.parsed_tx.message === 'PRIVATE_TRANSFER' || 
                                                                     selectedTx.parsed_tx.message === '505249564154455f5452414e53464552' ||
                                                                     (selectedTx.parsed_tx.amount === '0' && selectedTx.parsed_tx.message);
                                            
                                            if (isPrivateTransfer) {
                                              return (
                                                <div className="flex items-center gap-1">
                                                  <Shield className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                                                  <span className="text-purple-600 dark:text-purple-400 font-medium">private OCT</span>
                                                </div>
                                              );
                                            }
                                            
                                            return selectedTx.parsed_tx.amount_raw;
                                          })()}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Nonce:</span>
                                        <div>{selectedTx.parsed_tx.nonce}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">OU:</span>
                                        <div>{selectedTx.parsed_tx.ou}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Timestamp:</span>
                                        <div>{new Date(selectedTx.parsed_tx.timestamp * 1000).toLocaleString()}</div>
                                      </div>
                                      <div>
                                        <span className="font-medium">Source:</span>
                                        <div>{selectedTx.source}</div>
                                      </div>
                                      {selectedTx.parsed_tx.message && (
                                        <div className="col-span-2">
                                          <span className="font-medium">Message:</span>
                                          <div className="mt-1 p-2 bg-muted rounded text-sm flex items-center gap-2">
                                            {selectedTx.parsed_tx.message === 'PRIVATE_TRANSFER' || 
                                             selectedTx.parsed_tx.message === '505249564154455f5452414e53464552' ? (
                                              <>
                                                <Shield className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                                <span className="text-purple-600 dark:text-purple-400 font-medium">Private Transfer</span>
                                              </>
                                            ) : (
                                              selectedTx.parsed_tx.message
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      <div className="col-span-2">
                                        <span className="font-medium">Raw Data:</span>
                                        <div className="mt-1 p-2 bg-muted rounded text-xs font-mono break-all max-h-32 overflow-y-auto">
                                          {selectedTx.data}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div>No details available</div>
                              )}
                            </DialogContent>
                          </Dialog>
                          {tx.status === 'confirmed' && (
                            <Button variant="ghost" size="sm" asChild>
                              <a
                                href={`https://octrascan.io/tx/${tx.hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Transaction Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
                        <div className="space-y-2">
                          <div>
                            <span className="text-muted-foreground">Amount:</span>
                            <div className="font-mono font-medium flex items-center gap-2">
                              {(() => {
                                // Check if this is a private transfer
                                const isPrivateTransfer = tx.message === 'PRIVATE_TRANSFER' || 
                                                         tx.message === '505249564154455f5452414e53464552' || // hex encoded PRIVATE_TRANSFER
                                                         (tx.amount === 0 && tx.message);
                                
                                if (isPrivateTransfer) {
                                  return (
                                    <div className="flex items-center gap-1">
                                      <Shield className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                                      <span className="text-purple-600 dark:text-purple-400">private OCT</span>
                                    </div>
                                  );
                                }
                                
                                return `${tx.amount?.toFixed(8) || '0.00000000'} OCT`;
                              })()}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Hash:</span>
                            <div className="font-mono break-all text-xs">{truncateHash(tx.hash || 'N/A')}</div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-muted-foreground">
                              {tx.type === 'sent' ? 'To:' : 'From:'}
                            </span>
                            <div className="font-mono">
                              <span className="break-all text-xs">{truncateAddress(tx.type === 'sent' ? tx.to : tx.from)}</span>
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Date:</span>
                            <div>{formatDate(tx.timestamp || 0)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {index < transactions.length - 1 && <Separator className="mt-4" />}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="contracts" className="mt-4">
            {contractHistory.length === 0 ? (
              <Alert>
                <div className="flex items-start space-x-3">
                  <Code className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <AlertDescription>
                    No contract interactions found for this wallet.
                  </AlertDescription>
                </div>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Recent {contractHistory.length} contract interactions
                </div>
                {contractHistory.map((interaction, index) => (
                  <div key={index}>
                    <div className="space-y-3">
                      {/* Contract Interaction Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {interaction.type === 'view' ? (
                            <Eye className="h-4 w-4 text-blue-500" />
                          ) : (
                            <Send className="h-4 w-4 text-orange-500" />
                          )}
                          <span className="font-medium">{interaction.methodName}</span>
                          <Badge variant={interaction.type === 'view' ? 'secondary' : 'default'} className="text-xs">
                            {interaction.type}
                          </Badge>
                          <div className="flex items-center gap-1">
                            {interaction.success ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <Badge variant={interaction.success ? 'default' : 'destructive'} className="text-xs">
                              {interaction.success ? 'Success' : 'Failed'}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {interaction.txHash && (
                            <Button variant="ghost" size="sm" asChild>
                              <a
                                href={`https://octrascan.io/tx/${interaction.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Contract Interaction Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
                        <div className="space-y-2">
                          <div>
                            <span className="text-muted-foreground">Contract:</span>
                            <div className="font-mono break-all text-xs">{truncateAddress(interaction.contractAddress)}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Parameters:</span>
                            <div className="text-xs">
                              {interaction.params.length > 0 ? (
                                <div className="space-y-1">
                                  {interaction.params.map((param, i) => (
                                    <div key={i} className="font-mono bg-muted p-1 rounded">
                                      {param || 'empty'}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                'No parameters'
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-muted-foreground">Result:</span>
                            <div className="text-xs">
                              {interaction.success ? (
                                interaction.result ? (
                                  <div className="font-mono bg-green-50 dark:bg-green-950/50 p-2 rounded break-all">
                                    {typeof interaction.result === 'object' 
                                      ? JSON.stringify(interaction.result, null, 2)
                                      : String(interaction.result)
                                    }
                                  </div>
                                ) : interaction.txHash ? (
                                  <div className="font-mono bg-green-50 dark:bg-green-950/50 p-2 rounded break-all">
                                    TX: {truncateHash(interaction.txHash)}
                                  </div>
                                ) : (
                                  'Success'
                                )
                              ) : (
                                <div className="font-mono bg-red-50 dark:bg-red-950/50 p-2 rounded break-all text-red-600">
                                  {interaction.error || 'Unknown error'}
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Date:</span>
                            <div>{new Date(interaction.timestamp).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {index < contractHistory.length - 1 && <Separator className="mt-4" />}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}