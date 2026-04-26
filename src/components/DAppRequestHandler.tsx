/**
 * DAppRequestHandler - Unified handler for all dApp requests
 * 
 * Handles:
 * - Connection requests (connect to Circle)
 * - Capability requests (request scoped authorization)
 * - Invoke requests (execute method with capability)
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  Check, 
  X, 
  AlertTriangle, 
  Globe,
  Lock,
  Cpu,
  Eye,
  Edit,
  Zap
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';
import { 
  signCapability, 
  generateNonceBase, 
  createCapabilityId,
  type CapabilityPayload
} from '../utils/capability';
import { WalletManager } from '../utils/walletManager';
import { createTransaction, sendTransaction, fetchBalance } from '../utils/api';
import { sendEVMTransaction, sendERC20Transaction } from '../utils/evmRpc';
import { deriveEvmFromOctraKey } from '../utils/evmDerive';
import { logger } from '@/utils/logger';
import nacl from 'tweetnacl';

// Types
interface ConnectionRequest {
  circle: string;
  appOrigin: string;
  appName?: string;
  appIcon?: string;
  requestedCapabilities?: CapabilityTemplate[];
}

interface CapabilityTemplate {
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
}

interface CapabilityRequest {
  circle: string;
  methods: string[];
  scope: 'read' | 'write' | 'compute';
  encrypted: boolean;
  ttlSeconds?: number;
  appOrigin: string;
  appName?: string;
  appIcon?: string;
}

interface TransactionPayload {
  to: string;
  amount: number;
  message?: string;
}

interface EVMTransactionPayload {
  to: string;
  amount?: string;
  value?: string;
  data?: string;
  network?: string;  // optional network override, e.g. 'eth-mainnet'
}

interface ERC20TransactionPayload {
  tokenContract: string; // ERC20 contract address
  to: string;            // Recipient address
  amount: string;        // Amount in smallest units (e.g., 6 decimals for USDC)
  decimals: number;      // Token decimals
  symbol: string;        // Token symbol (e.g., "USDC")
  metadata?: unknown;    // Optional metadata for the transaction
}

interface InvokeRequest {
  capabilityId: string;
  method: string;
  payload?: unknown;
  nonce: number;
  timestamp: number;
  appOrigin: string;
  appName?: string;
  capability: {
    circle: string;
    methods: string[];
    scope: string;
    encrypted: boolean;
  };
  connection?: {
    walletPubKey: string;
    network: string;
  };
}

interface SignMessageRequest {
  message: string;
  appOrigin: string;
  appName?: string;
  appIcon?: string;
  timestamp: number;
}

interface DAppRequestHandlerProps {
  wallets: Wallet[];
}

type RequestType = 'connection' | 'capability' | 'invoke' | 'signMessage' | null;

export function DAppRequestHandler({ wallets }: DAppRequestHandlerProps) {
  logger.debug('DAppRequestHandler: Component mounted/rendered');
  logger.debug('DAppRequestHandler: Render', { 
    walletCount: wallets.length, 
    addresses: wallets.map(w => w.address.slice(0, 10)) 
  });
  
  const [requestType, setRequestType] = useState<RequestType>(null);
  const [connectionRequest, setConnectionRequest] = useState<ConnectionRequest | null>(null);
  const [capabilityRequest, setCapabilityRequest] = useState<CapabilityRequest | null>(null);
  const [invokeRequest, setInvokeRequest] = useState<InvokeRequest | null>(null);
  const [signMessageRequest, setSignMessageRequest] = useState<SignMessageRequest | null>(null);
  const [parsedTxPayload, setParsedTxPayload] = useState<TransactionPayload | null>(null);
  const [parsedEvmTxPayload, setParsedEvmTxPayload] = useState<EVMTransactionPayload | null>(null);
  const [parsedErc20TxPayload, setParsedErc20TxPayload] = useState<ERC20TransactionPayload | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(wallets[0] || null);
  const [isProcessing, setIsProcessing] = useState(false);
  // Custom gas settings for EVM transactions — defaults from successful bridge tx
  const [customGasLimit, setCustomGasLimit] = useState('150000');
  const [customMaxFeeGwei, setCustomMaxFeeGwei] = useState('3');
  const { toast } = useToast();

  // Sync selectedWallet when wallets prop changes
  useEffect(() => {
    if (wallets.length > 0 && !selectedWallet) {
      setSelectedWallet(wallets[0]);
    } else if (wallets.length > 0 && selectedWallet) {
      // Ensure selectedWallet is still in the wallets list
      const stillExists = wallets.find(w => w.address === selectedWallet.address);
      if (!stillExists) {
        setSelectedWallet(wallets[0]);
      }
    }
  }, [wallets, selectedWallet]);

  // IMPORTANT: Select the correct wallet based on invoke request's connection
  // This ensures we use the wallet that was originally connected to the dApp
  useEffect(() => {
    if (invokeRequest?.connection?.walletPubKey && wallets.length > 0) {
      const connectedWallet = wallets.find(w => w.address === invokeRequest.connection!.walletPubKey);
      if (connectedWallet) {
        logger.debug('DAppRequestHandler: Using connected wallet:', connectedWallet.address);
        setSelectedWallet(connectedWallet);
      } else {
        logger.warn('DAppRequestHandler: Connected wallet not found:', invokeRequest.connection.walletPubKey);
        logger.warn('DAppRequestHandler: Available wallets:', wallets.map(w => w.address));
      }
    }
  }, [invokeRequest, wallets]);

  // For signMessage: select wallet matching the stored connection for this origin
  useEffect(() => {
    if (!signMessageRequest || wallets.length === 0) return;
    const selectWalletForOrigin = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const data = await chrome.storage.local.get(['connectedDApps']);
          const connections: Array<{ appOrigin: string; walletPubKey: string }> = data.connectedDApps || [];
          const conn = connections.find(c => c.appOrigin === signMessageRequest.appOrigin);
          if (conn?.walletPubKey) {
            const wallet = wallets.find(w => w.address === conn.walletPubKey);
            if (wallet) {
              logger.debug('DAppRequestHandler: signMessage — using wallet from connection:', wallet.address);
              setSelectedWallet(wallet);
              return;
            }
          }
        }
      } catch (e) {
        logger.warn('DAppRequestHandler: Could not resolve wallet for signMessage origin');
      }
    };
    selectWalletForOrigin();
  }, [signMessageRequest, wallets]);

  useEffect(() => {
    logger.debug('DAppRequestHandler: useEffect triggered - loading pending request');
    loadPendingRequest();

    // Listen for new pending requests while popup is open
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes.pendingInvokeRequest?.newValue) {
          logger.debug('DAppRequestHandler: New invoke request detected via storage change');
          // Reset state then load — ensures invoke screen shows fresh
          setRequestType(null);
          setIsProcessing(false);
          setTimeout(() => loadPendingRequest(), 50);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, []);

  const loadPendingRequest = async () => {
    // Check for pending requests in order of priority
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (action === 'connect') {
      const circle = urlParams.get('circle');
      const appOrigin = urlParams.get('appOrigin');
      if (circle && appOrigin) {
        setRequestType('connection');
        setConnectionRequest({
          circle: decodeURIComponent(circle),
          appOrigin: decodeURIComponent(appOrigin),
          appName: urlParams.get('appName') ? decodeURIComponent(urlParams.get('appName')!) : undefined,
          appIcon: urlParams.get('appIcon') ? decodeURIComponent(urlParams.get('appIcon')!) : undefined
        });
        return;
      }
    }

    if (action === 'capability') {
      const circle = urlParams.get('circle');
      const methods = urlParams.get('methods');
      const scope = urlParams.get('scope');
      if (circle && methods && scope) {
        setRequestType('capability');
        setCapabilityRequest({
          circle: decodeURIComponent(circle),
          methods: JSON.parse(decodeURIComponent(methods)),
          scope: decodeURIComponent(scope) as 'read' | 'write' | 'compute',
          encrypted: urlParams.get('encrypted') === 'true',
          appOrigin: urlParams.get('appOrigin') ? decodeURIComponent(urlParams.get('appOrigin')!) : window.location.origin,
          appName: urlParams.get('appName') ? decodeURIComponent(urlParams.get('appName')!) : undefined
        });
        return;
      }
    }

    if (action === 'signMessage') {
      const appOrigin = urlParams.get('appOrigin');
      const message = urlParams.get('message');
      if (appOrigin && message) {
        logger.debug('DAppRequestHandler: Loading sign message from URL params');
        setRequestType('signMessage');
        setSignMessageRequest({
          message: decodeURIComponent(message),
          appOrigin: decodeURIComponent(appOrigin),
          appName: urlParams.get('appName') ? decodeURIComponent(urlParams.get('appName')!) : undefined,
          appIcon: urlParams.get('appIcon') ? decodeURIComponent(urlParams.get('appIcon')!) : undefined,
          timestamp: Date.now()
        });
        return;
      }
    }

    // Check chrome storage for pending requests
    if (typeof chrome !== 'undefined' && chrome.storage) {
      logger.debug('DAppRequestHandler: Checking chrome.storage for pending requests...');
      
      const pending = await chrome.storage.local.get([
        'pendingConnectionRequest',
        'pendingCapabilityRequest',
        'pendingInvokeRequest',
        'pendingSignMessageRequest'
      ]);

      logger.debug('DAppRequestHandler: Pending requests:', {
        connection: !!pending.pendingConnectionRequest,
        capability: !!pending.pendingCapabilityRequest,
        invoke: !!pending.pendingInvokeRequest,
        signMessage: !!pending.pendingSignMessageRequest
      });

      if (pending.pendingConnectionRequest) {
        logger.debug('DAppRequestHandler: Loading connection request');
        setRequestType('connection');
        setConnectionRequest(pending.pendingConnectionRequest);
      } else if (pending.pendingCapabilityRequest) {
        logger.debug('DAppRequestHandler: Loading capability request');
        setRequestType('capability');
        setCapabilityRequest(pending.pendingCapabilityRequest);
      } else if (pending.pendingSignMessageRequest) {
        logger.debug('DAppRequestHandler: Loading sign message request:', pending.pendingSignMessageRequest);
        setRequestType('signMessage');
        setSignMessageRequest(pending.pendingSignMessageRequest);
      } else if (pending.pendingInvokeRequest) {
        logger.debug('DAppRequestHandler: Loading invoke request');
        setRequestType('invoke');
        setInvokeRequest(pending.pendingInvokeRequest);
        
        // Parse transaction payload for send_transaction method
        if (pending.pendingInvokeRequest.method === 'send_transaction') {
          try {
            const payload = pending.pendingInvokeRequest.payload;
            let txParams: TransactionPayload | null = null;
            
            if (payload && typeof payload === 'object' && '_type' in payload && (payload as { _type: string })._type === 'Uint8Array') {
              const payloadWithData = payload as unknown as { _type: string; data: number[] };
              const bytes = new Uint8Array(payloadWithData.data);
              txParams = JSON.parse(new TextDecoder().decode(bytes));
            } else if (payload instanceof Uint8Array) {
              txParams = JSON.parse(new TextDecoder().decode(payload));
            } else if (typeof payload === 'object' && payload !== null && '0' in payload) {
              const obj = payload as Record<string, number>;
              const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)));
              const length = keys.length;
              const bytes = new Uint8Array(length);
              for (let i = 0; i < length; i++) {
                bytes[i] = obj[i.toString()];
              }
              txParams = JSON.parse(new TextDecoder().decode(bytes));
            } else if (payload) {
              txParams = payload as TransactionPayload;
            }
            
            if (txParams) {
              setParsedTxPayload(txParams);
              logger.debug('DAppRequestHandler: Parsed tx payload:', txParams);
            }
          } catch (e) {
            logger.error('DAppRequestHandler: Failed to parse tx payload for display:', e);
          }
        }
        
        // Parse EVM transaction payload for send_evm_transaction method
        if (pending.pendingInvokeRequest.method === 'send_evm_transaction') {
          try {
            const payload = pending.pendingInvokeRequest.payload;
            let evmTxParams: EVMTransactionPayload | null = null;
            
            if (payload && typeof payload === 'object' && '_type' in payload && (payload as { _type: string })._type === 'Uint8Array') {
              const payloadWithData = payload as unknown as { _type: string; data: number[] };
              const bytes = new Uint8Array(payloadWithData.data);
              evmTxParams = JSON.parse(new TextDecoder().decode(bytes));
            } else if (payload instanceof Uint8Array) {
              evmTxParams = JSON.parse(new TextDecoder().decode(payload));
            } else if (typeof payload === 'object' && payload !== null && '0' in payload) {
              const obj = payload as Record<string, number>;
              const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)));
              const length = keys.length;
              const bytes = new Uint8Array(length);
              for (let i = 0; i < length; i++) {
                bytes[i] = obj[i.toString()];
              }
              evmTxParams = JSON.parse(new TextDecoder().decode(bytes));
            } else if (payload) {
              evmTxParams = payload as EVMTransactionPayload;
            }
            
            if (evmTxParams) {
              setParsedEvmTxPayload(evmTxParams);
              logger.debug('DAppRequestHandler: Parsed EVM tx payload:', evmTxParams);
            }
          } catch (e) {
            logger.error('DAppRequestHandler: Failed to parse EVM tx payload for display:', e);
          }
        }
        
        // Parse ERC20 transaction payload for send_erc20_transaction method
        if (pending.pendingInvokeRequest.method === 'send_erc20_transaction') {
          try {
            const payload = pending.pendingInvokeRequest.payload;
            let erc20TxParams: ERC20TransactionPayload | null = null;
            
            if (payload && typeof payload === 'object' && '_type' in payload && (payload as { _type: string })._type === 'Uint8Array') {
              const payloadWithData = payload as unknown as { _type: string; data: number[] };
              const bytes = new Uint8Array(payloadWithData.data);
              erc20TxParams = JSON.parse(new TextDecoder().decode(bytes));
            } else if (payload instanceof Uint8Array) {
              erc20TxParams = JSON.parse(new TextDecoder().decode(payload));
            } else if (typeof payload === 'object' && payload !== null && '0' in payload) {
              const obj = payload as Record<string, number>;
              const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)));
              const length = keys.length;
              const bytes = new Uint8Array(length);
              for (let i = 0; i < length; i++) {
                bytes[i] = obj[i.toString()];
              }
              erc20TxParams = JSON.parse(new TextDecoder().decode(bytes));
            } else if (payload) {
              erc20TxParams = payload as ERC20TransactionPayload;
            }
            
            if (erc20TxParams) {
              setParsedErc20TxPayload(erc20TxParams);
              logger.debug('DAppRequestHandler: Parsed ERC20 tx payload:', erc20TxParams);
            }
          } catch (e) {
            logger.error('DAppRequestHandler: Failed to parse ERC20 tx payload for display:', e);
          }
        }
      }
    }
  };

  const handleConnectionApprove = async () => {
    if (!connectionRequest) return;
    
    // Ensure we have a wallet selected
    if (!selectedWallet) {
      logger.error('No wallet selected for connection approval');
      toast({ title: 'Error', description: 'No wallet available', variant: 'destructive' });
      return;
    }
    
    setIsProcessing(true);

    try {
      // Get current network from active RPC provider
      // Priority: 1) Active RPC provider's network, 2) chrome.storage selectedNetwork, 3) default mainnet
      let currentNetwork: 'mainnet' | 'testnet' = 'mainnet';
      
      // First try to get from rpcProviders (most accurate source)
      const rpcProviders = localStorage.getItem('rpcProviders');
      if (rpcProviders) {
        try {
          const providers = JSON.parse(rpcProviders);
          const activeProvider = providers.find((p: { isActive: boolean }) => p.isActive);
          if (activeProvider?.network) {
            currentNetwork = activeProvider.network;
            logger.debug('DAppRequestHandler: Network from active RPC provider:', currentNetwork);
          }
        } catch (e) {
          console.warn('Failed to parse rpcProviders:', e);
        }
      }
      
      // Fallback to chrome.storage.local if no active provider found
      if (!rpcProviders && typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get(['selectedNetwork', 'rpcProviders']);
        if (result.selectedNetwork) {
          currentNetwork = result.selectedNetwork;
        } else if (result.rpcProviders) {
          try {
            const providers = JSON.parse(result.rpcProviders);
            const activeProvider = providers.find((p: { isActive: boolean }) => p.isActive);
            if (activeProvider?.network) {
              currentNetwork = activeProvider.network;
            }
          } catch (e) {
            console.warn('Failed to parse rpcProviders from chrome.storage:', e);
          }
        }
      }
      
      logger.debug('DAppRequestHandler: Final network:', currentNetwork);
      
      // Store connection
      const connections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
      const filtered = connections.filter((c: { appOrigin: string }) => c.appOrigin !== connectionRequest.appOrigin);
      filtered.push({
        circle: connectionRequest.circle,
        appOrigin: connectionRequest.appOrigin,
        appName: connectionRequest.appName || connectionRequest.appOrigin,
        walletPubKey: selectedWallet.address,
        network: currentNetwork,
        connectedAt: Date.now()
      });
      localStorage.setItem('connectedDApps', JSON.stringify(filtered));

      // Send response - include both field names for compatibility
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        let evmAddress = '';

        // Always derive EVM address from privateKey if available (most reliable)
        if (selectedWallet.privateKey) {
          try {
            const derived = deriveEvmFromOctraKey(selectedWallet.privateKey);
            evmAddress = derived.evmAddress;
            logger.debug('DAppRequestHandler: Derived EVM address from privateKey:', evmAddress);
          } catch (e) {
            logger.error('DAppRequestHandler: Failed to derive EVM address:', e);
          }
        } else {
          logger.warn('DAppRequestHandler: No privateKey in selectedWallet!');
          // Fallback: try from storage
          evmAddress = WalletManager.getEvmAddress(selectedWallet.address);
          if (evmAddress) {
            logger.debug('DAppRequestHandler: Got EVM address from storage:', evmAddress);
          }
        }

        if (!evmAddress) {
          logger.error('DAppRequestHandler: ERROR: Could not get EVM address!');
          logger.error('DAppRequestHandler: selectedWallet:', {
            address: selectedWallet.address,
            hasPrivateKey: !!selectedWallet.privateKey,
          });
        }

        const currentEpoch = Date.now();
        const currentBranchId = 'main';
        
        logger.debug('DAppRequestHandler: Sending CONNECTION_RESULT:', {
          appOrigin: connectionRequest.appOrigin,
          walletPubKey: selectedWallet.address,
          evmAddress: evmAddress || '(MISSING!)',
          network: currentNetwork,
          epoch: currentEpoch,
          branchId: currentBranchId
        });
        
        chrome.runtime.sendMessage({
          type: 'CONNECTION_RESULT',
          appOrigin: connectionRequest.appOrigin,
          origin: connectionRequest.appOrigin,
          approved: true,
          walletPubKey: selectedWallet.address,
          address: selectedWallet.address,
          evmAddress,
          network: currentNetwork,
          epoch: currentEpoch,
          branchId: currentBranchId
        });
        chrome.storage.local.remove('pendingConnectionRequest');
      }

      // Success - close popup immediately (no toast needed)
      window.close();
    } catch (error) {
      console.error('Connection error:', error);
      setIsProcessing(false);
    }
  };

  const handleCapabilityApprove = async () => {
    if (!capabilityRequest || !selectedWallet) {
      logger.error('DAppRequestHandler: Missing capabilityRequest or selectedWallet');
      return;
    }
    
    logger.debug('DAppRequestHandler: Starting capability approval...');
    logger.debug('DAppRequestHandler: Capability request:', capabilityRequest);
    logger.debug('DAppRequestHandler: Selected wallet address:', selectedWallet.address);
    // SECURITY: Do not log private key details
    logger.debug('DAppRequestHandler: Wallet ready for signing:', !!selectedWallet.privateKey);
    
    // Validate private key exists
    if (!selectedWallet.privateKey) {
      logger.error('DAppRequestHandler: ERROR: Wallet has no private key!');
      logger.error('DAppRequestHandler: Wallet object keys:', Object.keys(selectedWallet));
      toast({ 
        title: 'Error', 
        description: 'Wallet private key not available. Please unlock your wallet.', 
        variant: 'destructive' 
      });
      return;
    }
    
    setIsProcessing(true);

    try {
      const now = Date.now();
      const defaultTTL = 24 * 60 * 60 * 1000;
      
      const currentEpoch = Date.now();
      const currentBranchId = 'main';
      
      const payload: CapabilityPayload = {
        version: 2,
        circle: capabilityRequest.circle,
        methods: capabilityRequest.methods,
        scope: capabilityRequest.scope,
        encrypted: capabilityRequest.encrypted,
        appOrigin: capabilityRequest.appOrigin,
        branchId: currentBranchId,
        epoch: currentEpoch,
        issuedAt: now,
        expiresAt: capabilityRequest.ttlSeconds 
          ? now + capabilityRequest.ttlSeconds * 1000 
          : now + defaultTTL,
        nonceBase: generateNonceBase()
      };

      logger.debug('DAppRequestHandler: Capability payload:', payload);

      // Sign capability with wallet's private key
      logger.debug('DAppRequestHandler: Calling signCapability...');
      const signedCapability = await signCapability(payload, selectedWallet.privateKey);
      
      logger.debug('DAppRequestHandler: Capability signed successfully!');
      
      // Create capability ID
      const capabilityId = createCapabilityId(signedCapability);
      
      logger.debug('DAppRequestHandler: Signed capability:', {
        id: capabilityId,
        walletPubKey: signedCapability.walletPubKey,
        signature: signedCapability.signature.slice(0, 32) + '...',
        fullSignature: signedCapability.signature
      });

      // Send response with full signed capability
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        logger.debug('DAppRequestHandler: Sending CAPABILITY_RESULT to background...');
        
        const message = {
          type: 'CAPABILITY_RESULT',
          appOrigin: capabilityRequest.appOrigin,
          approved: true,
          capabilityId,
          signedCapability
        };
        
        logger.debug('DAppRequestHandler: Message to send:', message);
        
        chrome.runtime.sendMessage(message, (response) => {
          logger.debug('DAppRequestHandler: Background response:', response);
          if (chrome.runtime.lastError) {
            logger.error('DAppRequestHandler: Chrome runtime error:', chrome.runtime.lastError);
          }
        });
        
        await chrome.storage.local.remove('pendingCapabilityRequest');
        logger.debug('DAppRequestHandler: Removed pendingCapabilityRequest from storage');
      }

      // Success — don't close popup. Wait for invoke request to arrive in storage,
      // then switch to invoke screen. Background stores pendingInvokeRequest after
      // processing CAPABILITY_RESULT, which triggers our storage change listener.
      logger.debug('DAppRequestHandler: Capability approved, waiting for invoke request...');
      setIsProcessing(false);
      // Give background time to store pendingInvokeRequest (usually <500ms)
      // Storage change listener will auto-switch to invoke screen
      setTimeout(async () => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const pending = await chrome.storage.local.get(['pendingInvokeRequest']);
          if (pending.pendingInvokeRequest) {
            setRequestType(null);
            setTimeout(() => loadPendingRequest(), 50);
          } else {
            // No invoke request — close popup
            window.close();
          }
        } else {
          window.close();
        }
      }, 1000);
    } catch (error) {
      logger.error('DAppRequestHandler: Capability error:', error);
      logger.error('DAppRequestHandler: Error stack:', error instanceof Error ? error.stack : 'No stack');
      toast({ title: 'Error', description: `Failed to sign capability: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  const handleInvokeApprove = async () => {
    if (!invokeRequest || !selectedWallet) return;
    setIsProcessing(true);

    try {
      logger.debug('DAppRequestHandler: Processing invoke:', invokeRequest.method);
      
      // Handle send_transaction method - use existing wallet transaction functions
      if (invokeRequest.method === 'send_transaction') {
        logger.debug('DAppRequestHandler: Executing send_transaction...');
        
        // Parse the transaction payload
        let txParams: TransactionPayload;
        const payload = invokeRequest.payload;
        
        try {
          if (payload && typeof payload === 'object' && '_type' in payload && (payload as { _type: string })._type === 'Uint8Array') {
            const payloadWithData = payload as unknown as { _type: string; data: number[] };
            const bytes = new Uint8Array(payloadWithData.data);
            txParams = JSON.parse(new TextDecoder().decode(bytes));
          } else if (payload instanceof Uint8Array) {
            txParams = JSON.parse(new TextDecoder().decode(payload));
          } else if (typeof payload === 'object' && payload !== null && '0' in payload) {
            // Handle serialized Uint8Array
            const obj = payload as Record<string, number>;
            const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)));
            const length = keys.length;
            const bytes = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
              bytes[i] = obj[i.toString()];
            }
            txParams = JSON.parse(new TextDecoder().decode(bytes));
          } else {
            txParams = payload as TransactionPayload;
          }
        } catch (e) {
          logger.error('DAppRequestHandler: Failed to parse tx payload:', e);
          throw new Error('Failed to parse transaction payload');
        }
        
        logger.debug('DAppRequestHandler: Transaction params:', txParams);
        logger.debug('DAppRequestHandler:   to:', txParams.to);
        logger.debug('DAppRequestHandler:   amount:', txParams.amount);
        logger.debug('DAppRequestHandler:   message:', txParams.message ? '(present)' : '(empty)');
        
        // Validate transaction parameters
        if (!txParams.to || typeof txParams.to !== 'string') {
          throw new Error('Invalid recipient address');
        }
        if (typeof txParams.amount !== 'number' || !Number.isFinite(txParams.amount) || txParams.amount <= 0) {
          throw new Error('Invalid transaction amount');
        }
        
        // Validate wallet has private key
        if (!selectedWallet.privateKey) {
          throw new Error('Wallet private key not available. Please unlock your wallet.');
        }
        
        // Get current nonce and add 1 for new transaction
        // IMPORTANT: Force refresh to get latest nonce from chain, not cached
        logger.debug('DAppRequestHandler: Fetching nonce for:', selectedWallet.address);
        const balanceData = await fetchBalance(selectedWallet.address, true); // Force refresh!
        const currentNonce = balanceData.nonce;
        const txNonce = currentNonce + 1; // IMPORTANT: nonce must be current + 1
        
        // Derive public key from private key using nacl
        const privateKeyBuffer = Buffer.from(selectedWallet.privateKey, 'base64');
        const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBuffer.slice(0, 32));
        const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
        
        logger.debug('DAppRequestHandler: Creating transaction...');
        logger.debug('DAppRequestHandler:   currentNonce:', currentNonce);
        logger.debug('DAppRequestHandler:   txNonce (current+1):', txNonce);
        
        // Create and sign transaction using existing wallet functions
        const transaction = createTransaction(
          selectedWallet.address,
          txParams.to,
          txParams.amount,
          txNonce, // Use current nonce + 1
          selectedWallet.privateKey,
          publicKeyHex,
          txParams.message // Include intent payload as message
        );
        
        logger.debug('DAppRequestHandler: Sending transaction to Octra chain...');
        const txResult = await sendTransaction(transaction);
        
        logger.debug('DAppRequestHandler: Transaction result:', txResult);
        
        if (!txResult.success || !txResult.hash) {
          throw new Error(txResult.error || 'Transaction failed');
        }
        
        // Return the result to dApp
        const resultData = {
          success: true,
          txHash: txResult.hash,
          from: selectedWallet.address,
          to: txParams.to,
          amount: txParams.amount,
          timestamp: Date.now(),
        };
        
        logger.debug('DAppRequestHandler: ✅ Transaction sent! txHash:', txResult.hash);
        
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'INVOKE_RESULT',
            appOrigin: invokeRequest.appOrigin,
            approved: true,
            data: new TextEncoder().encode(JSON.stringify(resultData))
          });
          chrome.storage.local.remove('pendingInvokeRequest');
        }
        
        // Success - close popup immediately (no toast needed)
      } else if (invokeRequest.method === 'send_evm_transaction') {
        // Handle EVM transaction (ETH on Sepolia)
        logger.debug('DAppRequestHandler: Executing send_evm_transaction...');
        
        // Parse the EVM transaction payload
        let evmTxParams: EVMTransactionPayload;
        const payload = invokeRequest.payload;
        
        try {
          if (payload && typeof payload === 'object' && '_type' in payload && (payload as { _type: string })._type === 'Uint8Array') {
            const payloadWithData = payload as unknown as { _type: string; data: number[] };
            const bytes = new Uint8Array(payloadWithData.data);
            evmTxParams = JSON.parse(new TextDecoder().decode(bytes));
          } else if (payload instanceof Uint8Array) {
            evmTxParams = JSON.parse(new TextDecoder().decode(payload));
          } else if (typeof payload === 'object' && payload !== null && '0' in payload) {
            const obj = payload as Record<string, number>;
            const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)));
            const length = keys.length;
            const bytes = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
              bytes[i] = obj[i.toString()];
            }
            evmTxParams = JSON.parse(new TextDecoder().decode(bytes));
          } else {
            evmTxParams = payload as EVMTransactionPayload;
          }
        } catch (e) {
          logger.error('DAppRequestHandler: Failed to parse EVM tx payload:', e);
          throw new Error('Failed to parse EVM transaction payload');
        }
        
        // Convert value (wei) to amount (ETH) if amount not provided
        let amountEth = evmTxParams.amount;
        if (!amountEth && evmTxParams.value) {
          // Convert wei to ETH
          const weiValue = BigInt(evmTxParams.value);
          amountEth = (Number(weiValue) / 1e18).toString();
          logger.debug('DAppRequestHandler: Converted value', { wei: evmTxParams.value, eth: amountEth });
        }
        
        if (!amountEth) {
          throw new Error('No amount or value provided for EVM transaction');
        }
        
        logger.debug('DAppRequestHandler: EVM Transaction params:', evmTxParams);
        logger.debug('DAppRequestHandler:   to:', evmTxParams.to);
        logger.debug('DAppRequestHandler: amount', { amount: amountEth, unit: 'ETH' });
        logger.debug('DAppRequestHandler:   value (wei):', evmTxParams.value || '(not provided)');
        logger.debug('DAppRequestHandler:   data:', evmTxParams.data ? '(present)' : '(empty)');
        
        // Validate EVM address format
        if (!evmTxParams.to || !/^0x[a-fA-F0-9]{40}$/.test(evmTxParams.to)) {
          throw new Error('Invalid EVM recipient address');
        }
        
        // Validate amount
        const amountNum = parseFloat(amountEth);
        if (!Number.isFinite(amountNum) || amountNum < 0) {
          throw new Error('Invalid transaction amount');
        }
        
        // Validate wallet has private key
        if (!selectedWallet.privateKey) {
          throw new Error('Wallet private key not available. Please unlock your wallet.');
        }
        
        // Get EVM private key from WalletManager (async - retrieves from session)
        const evmPrivateKey = await WalletManager.getEvmPrivateKey(selectedWallet.address);
        if (!evmPrivateKey) {
          throw new Error('EVM private key not found. Please re-import your wallet.');
        }

        // Determine network: use payload network if provided, else active wallet network
        let evmNetworkId = evmTxParams.network || 'eth-mainnet';
        if (!evmTxParams.network) {
          try {
            const stored = await chrome.storage.local.get(['active_evm_network']);
            if (stored.active_evm_network) evmNetworkId = stored.active_evm_network;
          } catch { /* use default */ }
        }
        
        logger.debug('DAppRequestHandler: Sending EVM transaction on network:', evmNetworkId);
        
        // Build gas overrides from custom inputs
        const gasOverrides: { gasLimit?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {}
        if (customGasLimit && parseInt(customGasLimit) > 0) {
          gasOverrides.gasLimit = BigInt(parseInt(customGasLimit))
        }
        if (customMaxFeeGwei && parseFloat(customMaxFeeGwei) > 0) {
          const { ethers: e } = await import('ethers')
          gasOverrides.maxFeePerGas = e.parseUnits(customMaxFeeGwei, 'gwei')
          gasOverrides.maxPriorityFeePerGas = e.parseUnits('0.1', 'gwei')
        }

        // Send EVM transaction using sendEVMTransaction
        const txHash = await sendEVMTransaction(
          evmPrivateKey,
          evmTxParams.to,
          amountEth,
          evmNetworkId,
          evmTxParams.data,
          Object.keys(gasOverrides).length > 0 ? gasOverrides : undefined
        );
        
        logger.debug('DAppRequestHandler: ✅ EVM Transaction sent! txHash:', txHash);
        
        // Return the result to dApp
        const resultData = {
          success: true,
          txHash,
          from: WalletManager.getEvmAddress(selectedWallet.address),
          to: evmTxParams.to,
          amount: amountEth,
          timestamp: Date.now(),
        };
        
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'INVOKE_RESULT',
            appOrigin: invokeRequest.appOrigin,
            approved: true,
            data: new TextEncoder().encode(JSON.stringify(resultData))
          });
          chrome.storage.local.remove('pendingInvokeRequest');
        }
        
        // Success - close popup immediately (no toast needed)
      } else if (invokeRequest.method === 'send_erc20_transaction') {
        // Handle ERC20 token transfer (e.g., USDC on Sepolia)
        logger.debug('DAppRequestHandler: Executing send_erc20_transaction...');
        
        // Parse the ERC20 transaction payload
        let erc20TxParams: ERC20TransactionPayload;
        const payload = invokeRequest.payload;
        
        try {
          if (payload && typeof payload === 'object' && '_type' in payload && (payload as { _type: string })._type === 'Uint8Array') {
            const payloadWithData = payload as unknown as { _type: string; data: number[] };
            const bytes = new Uint8Array(payloadWithData.data);
            erc20TxParams = JSON.parse(new TextDecoder().decode(bytes));
          } else if (payload instanceof Uint8Array) {
            erc20TxParams = JSON.parse(new TextDecoder().decode(payload));
          } else if (typeof payload === 'object' && payload !== null && '0' in payload) {
            const obj = payload as Record<string, number>;
            const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)));
            const length = keys.length;
            const bytes = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
              bytes[i] = obj[i.toString()];
            }
            erc20TxParams = JSON.parse(new TextDecoder().decode(bytes));
          } else {
            erc20TxParams = payload as ERC20TransactionPayload;
          }
        } catch (e) {
          logger.error('DAppRequestHandler: Failed to parse ERC20 tx payload:', e);
          throw new Error('Failed to parse ERC20 transaction payload');
        }
        
        // Calculate human-readable amount
        const amountHuman = Number(erc20TxParams.amount) / (10 ** erc20TxParams.decimals);
        
        logger.debug('DAppRequestHandler: ERC20 Transaction params:', erc20TxParams);
        logger.debug('DAppRequestHandler:   tokenContract:', erc20TxParams.tokenContract);
        logger.debug('DAppRequestHandler:   to:', erc20TxParams.to);
        logger.debug('DAppRequestHandler:   amount (raw):', erc20TxParams.amount);
        logger.debug('DAppRequestHandler: amount (human)', { amount: amountHuman, symbol: erc20TxParams.symbol });
        logger.debug('DAppRequestHandler:   decimals:', erc20TxParams.decimals);
        
        // Validate EVM addresses format
        if (!erc20TxParams.tokenContract || !/^0x[a-fA-F0-9]{40}$/.test(erc20TxParams.tokenContract)) {
          throw new Error('Invalid token contract address');
        }
        if (!erc20TxParams.to || !/^0x[a-fA-F0-9]{40}$/.test(erc20TxParams.to)) {
          throw new Error('Invalid recipient address');
        }
        
        // Validate amount
        if (!erc20TxParams.amount || !Number.isFinite(Number(erc20TxParams.amount)) || Number(erc20TxParams.amount) <= 0) {
          throw new Error('Invalid token amount');
        }
        
        // Validate decimals
        if (typeof erc20TxParams.decimals !== 'number' || !Number.isInteger(erc20TxParams.decimals) || erc20TxParams.decimals < 0 || erc20TxParams.decimals > 18) {
          throw new Error('Invalid token decimals');
        }
        
        // Validate wallet has private key
        if (!selectedWallet.privateKey) {
          throw new Error('Wallet private key not available. Please unlock your wallet.');
        }
        
        // Get EVM private key from WalletManager
        const evmPrivateKey = await WalletManager.getEvmPrivateKey(selectedWallet.address);
        if (!evmPrivateKey) {
          throw new Error('EVM private key not found. Please re-import your wallet.');
        }
        
        logger.debug('DAppRequestHandler: Sending ERC20 transfer to Sepolia...');
        
        // Send ERC20 transaction
        const txHash = await sendERC20Transaction(
          evmPrivateKey,
          erc20TxParams.tokenContract,
          erc20TxParams.to,
          erc20TxParams.amount,
          'eth-sepolia'
        );
        
        logger.debug('DAppRequestHandler: ✅ ERC20 Transaction sent! txHash:', txHash);
        
        // Return the result to dApp
        const resultData = {
          success: true,
          txHash,
          from: WalletManager.getEvmAddress(selectedWallet.address),
          to: erc20TxParams.to,
          tokenContract: erc20TxParams.tokenContract,
          amount: erc20TxParams.amount,
          amountHuman,
          symbol: erc20TxParams.symbol,
          timestamp: Date.now(),
        };
        
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'INVOKE_RESULT',
            appOrigin: invokeRequest.appOrigin,
            approved: true,
            data: new TextEncoder().encode(JSON.stringify(resultData))
          });
          chrome.storage.local.remove('pendingInvokeRequest');
        }
        
        // Success - close popup immediately (no toast needed)
      } else {
        // For other methods, return mock success (to be implemented)
        logger.debug('DAppRequestHandler: Executing other method:', invokeRequest.method);
        
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'INVOKE_RESULT',
            appOrigin: invokeRequest.appOrigin,
            approved: true,
            data: new Uint8Array([1, 2, 3])
          });
          chrome.storage.local.remove('pendingInvokeRequest');
        }
        
        // Success - close popup immediately (no toast needed)
      }
      
      window.close();
    } catch (error) {
      logger.error('DAppRequestHandler: Invoke error:', error);
      toast({ 
        title: 'Transaction Failed', 
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
      setIsProcessing(false);
    }
  };

  const handleReject = () => {
    setIsProcessing(true);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      if (requestType === 'connection' && connectionRequest) {
        chrome.runtime.sendMessage({
          type: 'CONNECTION_RESULT',
          appOrigin: connectionRequest.appOrigin,
          origin: connectionRequest.appOrigin, // For compatibility
          approved: false
        });
        chrome.storage.local.remove('pendingConnectionRequest');
      } else if (requestType === 'capability' && capabilityRequest) {
        chrome.runtime.sendMessage({
          type: 'CAPABILITY_RESULT',
          appOrigin: capabilityRequest.appOrigin,
          origin: capabilityRequest.appOrigin, // For compatibility
          approved: false
        });
        chrome.storage.local.remove('pendingCapabilityRequest');
      } else if (requestType === 'signMessage' && signMessageRequest) {
        chrome.runtime.sendMessage({
          type: 'SIGN_MESSAGE_RESULT',
          appOrigin: signMessageRequest.appOrigin,
          approved: false,
          error: 'User rejected request'
        });
        chrome.storage.local.remove('pendingSignMessageRequest');
      } else if (requestType === 'invoke' && invokeRequest) {
        chrome.runtime.sendMessage({
          type: 'INVOKE_RESULT',
          appOrigin: invokeRequest.appOrigin,
          origin: invokeRequest.appOrigin, // For compatibility
          approved: false
        });
        chrome.storage.local.remove('pendingInvokeRequest');
      }
    }

    window.close();
  };

  const handleSignMessageApprove = async () => {
    if (!signMessageRequest || !selectedWallet) {
      logger.error('DAppRequestHandler: Missing signMessageRequest or selectedWallet');
      return;
    }

    if (!selectedWallet.privateKey) {
      logger.error('DAppRequestHandler: Wallet has no private key');
      toast({ 
        title: 'Error', 
        description: 'Wallet private key not available. Please unlock your wallet.', 
        variant: 'destructive' 
      });
      return;
    }

    setIsProcessing(true);

    try {
      logger.debug('DAppRequestHandler: Signing message...');
      
      // Sign message with Ed25519
      const privateKeyBytes = Buffer.from(selectedWallet.privateKey, 'base64');
      const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBytes);
      const messageBytes = Buffer.from(signMessageRequest.message);
      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      logger.debug('DAppRequestHandler: Message signed successfully');

      // Send response
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          type: 'SIGN_MESSAGE_RESULT',
          appOrigin: signMessageRequest.appOrigin,
          approved: true,
          signature: signatureBase64
        });
        chrome.storage.local.remove('pendingSignMessageRequest');
      }

      // Success - close popup
      window.close();
    } catch (error) {
      logger.error('DAppRequestHandler: Sign message error:', error);
      toast({ 
        title: 'Error', 
        description: `Failed to sign message: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        variant: 'destructive' 
      });
      setIsProcessing(false);
    }
  };

  const truncateAddress = (address: string) => `${address.slice(0, 8)}...${address.slice(-6)}`;

  const getScopeIcon = (scope: string) => {
    switch (scope) {
      case 'read': return <Eye className="h-4 w-4" />;
      case 'write': return <Edit className="h-4 w-4" />;
      case 'compute': return <Cpu className="h-4 w-4" />;
      default: return <Shield className="h-4 w-4" />;
    }
  };

  const getScopeColor = (scope: string) => {
    switch (scope) {
      case 'read': return 'bg-green-100 text-green-800';
      case 'write': return 'bg-amber-100 text-amber-800';
      case 'compute': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // No pending request
  if (!requestType) return null;

  // Render based on request type - optimized for popup size (400x600)
  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">

      {/* ── HEADER ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 flex-shrink-0">
            {(connectionRequest?.appIcon || capabilityRequest?.appIcon || signMessageRequest?.appIcon) && (
              <AvatarImage src={connectionRequest?.appIcon || capabilityRequest?.appIcon || signMessageRequest?.appIcon} />
            )}
            <AvatarFallback className="bg-primary/10 text-primary">
              {requestType === 'connection' && <Globe className="h-5 w-5" />}
              {requestType === 'capability' && <Shield className="h-5 w-5" />}
              {requestType === 'invoke' && <Zap className="h-5 w-5" />}
              {requestType === 'signMessage' && <Edit className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {requestType === 'connection' && 'Connection Request'}
              {requestType === 'capability' && 'Capability Request'}
              {requestType === 'invoke' && 'Invoke Request'}
              {requestType === 'signMessage' && 'Sign Message'}
            </p>
            <p className="text-sm font-semibold truncate">
              {connectionRequest?.appName || capabilityRequest?.appName || invokeRequest?.appName || signMessageRequest?.appName || 'Unknown App'}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {connectionRequest?.appOrigin || capabilityRequest?.appOrigin || invokeRequest?.appOrigin || signMessageRequest?.appOrigin}
            </p>
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">

        {/* Connection */}
        {requestType === 'connection' && connectionRequest && (
          <>
            <div className="p-2.5 bg-muted/50 border border-border rounded space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Globe className="h-3 w-3" /><span className="font-medium">Circle</span>
              </div>
              <p className="text-xs font-mono break-all">{connectionRequest.circle}</p>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Select Account</h3>
              <select
                className="w-full p-2 border border-border rounded bg-background text-sm focus:outline-none focus:border-primary"
                value={selectedWallet?.address || ''}
                onChange={(e) => { const w = wallets.find(w => w.address === e.target.value); if (w) setSelectedWallet(w); }}
              >
                {wallets.map((w, i) => (
                  <option key={w.address} value={w.address}>Account {i + 1} — {truncateAddress(w.address)}</option>
                ))}
              </select>
            </div>
            <Alert className="py-2">
              <Shield className="h-3 w-3" />
              <AlertDescription className="text-xs">Creates a session. No authority granted until you approve capabilities.</AlertDescription>
            </Alert>
          </>
        )}

        {/* Capability */}
        {requestType === 'capability' && capabilityRequest && (
          <>
            <div className="p-2.5 bg-muted/50 border border-border rounded space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Circle</span>
                <span className="font-mono truncate max-w-[200px]">{capabilityRequest.circle}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Scope</span>
                <Badge className={`${getScopeColor(capabilityRequest.scope)} text-[10px] py-0 h-5`}>
                  {getScopeIcon(capabilityRequest.scope)}<span className="ml-1 capitalize">{capabilityRequest.scope}</span>
                </Badge>
              </div>
              {capabilityRequest.encrypted && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Encrypted</span>
                  <Badge variant="secondary" className="text-[10px] py-0 h-5"><Lock className="h-3 w-3 mr-1" />Yes</Badge>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Requested Methods</h3>
              <div className="space-y-1">
                {capabilityRequest.methods.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 border border-border rounded text-xs">
                    <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span className="font-mono">{m}</span>
                  </div>
                ))}
              </div>
            </div>
            {capabilityRequest.scope === 'write' || capabilityRequest.scope === 'compute' ? (
              <Alert className="py-2 border-amber-500/30 bg-amber-500/10">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                  Allows {capabilityRequest.scope} operations. Only approve if you trust this app.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="py-2"><Shield className="h-3 w-3" /><AlertDescription className="text-xs">Read-only — cannot modify data.</AlertDescription></Alert>
            )}
          </>
        )}

        {/* Invoke */}
        {requestType === 'invoke' && invokeRequest && (
          <>
            <div className="p-2.5 bg-muted/50 border border-border rounded space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Method</span>
                <span className="font-mono font-medium">{invokeRequest.method}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Circle</span>
                <span className="font-mono truncate max-w-[200px]">{invokeRequest.capability.circle}</span>
              </div>
            </div>

            {invokeRequest.method === 'send_transaction' && parsedTxPayload && (
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded space-y-2 text-xs">
                <h4 className="font-medium text-amber-600 dark:text-amber-400">OCT Transaction</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">To</span><span className="font-mono truncate max-w-[200px]">{parsedTxPayload.to}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold text-sm">{parsedTxPayload.amount} OCT</span></div>
                  {parsedTxPayload.message && (
                    <details className="pt-1 border-t border-amber-500/20">
                      <summary className="text-muted-foreground cursor-pointer select-none">Message / Payload</summary>
                      <div className="mt-1 p-1.5 bg-background rounded font-mono break-all max-h-24 overflow-y-auto">{parsedTxPayload.message}</div>
                    </details>
                  )}
                </div>
              </div>
            )}

            {invokeRequest.method === 'send_evm_transaction' && parsedEvmTxPayload && (
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded space-y-2 text-xs">
                <h4 className="font-medium text-blue-600 dark:text-blue-400">ETH Transaction</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Network</span>
                    <span className="font-medium">{parsedEvmTxPayload.network === 'eth-mainnet' ? 'Ethereum Mainnet' : parsedEvmTxPayload.network === 'eth-sepolia' ? 'Sepolia' : parsedEvmTxPayload.network || 'Ethereum Mainnet'}</span>
                  </div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">To</span><span className="font-mono truncate max-w-[200px]">{parsedEvmTxPayload.to}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-bold text-sm">{parsedEvmTxPayload.amount ? `${parsedEvmTxPayload.amount} ETH` : parsedEvmTxPayload.value ? `${(Number(parsedEvmTxPayload.value) / 1e18).toFixed(8)} ETH` : '0 ETH'}</span>
                  </div>
                  {parsedEvmTxPayload.data && (
                    <details className="pt-1 border-t border-blue-500/20">
                      <summary className="text-muted-foreground cursor-pointer select-none">Contract Data</summary>
                      <div className="mt-1 p-1.5 bg-background rounded font-mono break-all max-h-20 overflow-y-auto text-[10px]">{parsedEvmTxPayload.data}</div>
                    </details>
                  )}
                  <details className="pt-1 border-t border-blue-500/20">
                    <summary className="text-muted-foreground cursor-pointer select-none">Gas Settings</summary>
                    <div className="mt-2 flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Gas Limit</label>
                        <input type="number" value={customGasLimit} onChange={e => setCustomGasLimit(e.target.value)} className="w-full text-xs px-2 py-1 border border-border bg-background rounded focus:outline-none focus:border-primary font-mono" />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Max Fee (Gwei)</label>
                        <input type="number" step="0.1" value={customMaxFeeGwei} onChange={e => setCustomMaxFeeGwei(e.target.value)} className="w-full text-xs px-2 py-1 border border-border bg-background rounded focus:outline-none focus:border-primary font-mono" />
                      </div>
                    </div>
                    {customGasLimit && customMaxFeeGwei && (
                      <p className="text-[10px] text-muted-foreground mt-1">Est. max: {(parseInt(customGasLimit) * parseFloat(customMaxFeeGwei) / 1e9).toFixed(6)} ETH</p>
                    )}
                  </details>
                </div>
              </div>
            )}

            {invokeRequest.method === 'send_erc20_transaction' && parsedErc20TxPayload && (
              <div className="p-2.5 bg-green-500/10 border border-green-500/30 rounded space-y-2 text-xs">
                <h4 className="font-medium text-green-600 dark:text-green-400">{parsedErc20TxPayload.symbol} Transfer</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Token</span><span className="font-mono">{parsedErc20TxPayload.symbol}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">To</span><span className="font-mono truncate max-w-[200px]">{parsedErc20TxPayload.to}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-bold text-sm">{(Number(parsedErc20TxPayload.amount) / (10 ** parsedErc20TxPayload.decimals)).toFixed(2)} {parsedErc20TxPayload.symbol}</span>
                  </div>
                </div>
              </div>
            )}

            <Alert className={`py-2 ${invokeRequest.method === 'send_transaction' || invokeRequest.method === 'send_evm_transaction' || invokeRequest.method === 'send_erc20_transaction' ? 'border-amber-500/30 bg-amber-500/10' : ''}`}>
              {invokeRequest.method === 'send_transaction' || invokeRequest.method === 'send_evm_transaction' || invokeRequest.method === 'send_erc20_transaction' ? (
                <><AlertTriangle className="h-3 w-3 text-amber-500" /><AlertDescription className="text-xs text-amber-600 dark:text-amber-400">This will send funds from your wallet. Only approve if you trust this dApp.</AlertDescription></>
              ) : (
                <><Zap className="h-3 w-3" /><AlertDescription className="text-xs">Executes the method using your granted capability.</AlertDescription></>
              )}
            </Alert>
          </>
        )}

        {/* Sign Message */}
        {requestType === 'signMessage' && signMessageRequest && (
          <>
            <div className="p-2.5 bg-purple-500/10 border border-purple-500/30 rounded space-y-2">
              <h4 className="text-xs font-medium text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <Edit className="h-3.5 w-3.5" />Message to Sign
              </h4>
              <div className="p-2 bg-background border border-border rounded max-h-52 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all">{signMessageRequest.message}</pre>
              </div>
            </div>
            <Alert className="py-2 border-purple-500/30 bg-purple-500/10">
              <AlertTriangle className="h-3 w-3 text-purple-500" />
              <AlertDescription className="text-xs text-purple-600 dark:text-purple-400">Only sign messages you understand. This proves you own this wallet.</AlertDescription>
            </Alert>
          </>
        )}
      </div>

      {/* ── FOOTER ── */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border bg-background">
        {selectedWallet && (
          <p className="text-[10px] text-muted-foreground text-center mb-2 font-mono truncate">{selectedWallet.address}</p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReject} disabled={isProcessing}
            className="flex-1 h-10 text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-500">
            <X className="h-4 w-4 mr-1.5" />Reject
          </Button>
          <Button
            onClick={() => {
              logger.debug('DAppRequestHandler: Approve clicked', { requestType, wallet: selectedWallet?.address });
              if (requestType === 'connection') handleConnectionApprove();
              else if (requestType === 'capability') handleCapabilityApprove();
              else if (requestType === 'signMessage') handleSignMessageApprove();
              else if (requestType === 'invoke') handleInvokeApprove();
            }}
            disabled={isProcessing || !selectedWallet}
            className="flex-1 h-10">
            <Check className="h-4 w-4 mr-1.5" />
            {isProcessing ? 'Processing...' : !selectedWallet ? 'Loading...' : 'Approve'}
          </Button>
        </div>
      </div>
    </div>
  );
}

