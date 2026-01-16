/**
 * DAppRequestHandler - Unified handler for all dApp requests
 * 
 * Handles:
 * - Connection requests (connect to Circle)
 * - Capability requests (request scoped authorization)
 * - Invoke requests (execute method with capability)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  generateNonce, 
  createCapabilityId,
  type CapabilityPayload
} from '../utils/capability';
import { WalletManager } from '../utils/walletManager';
import { createTransaction, sendTransaction, fetchBalance } from '../utils/api';
import { sendEVMTransaction } from '../utils/evmRpc';
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
  amount: string; // ETH amount as string
  data?: string; // Hex encoded intent payload
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

interface DAppRequestHandlerProps {
  wallets: Wallet[];
}

type RequestType = 'connection' | 'capability' | 'invoke' | null;

export function DAppRequestHandler({ wallets }: DAppRequestHandlerProps) {
  console.log('[DAppRequestHandler] Render - wallets count:', wallets.length, 'addresses:', wallets.map(w => w.address.slice(0, 10)));
  
  const [requestType, setRequestType] = useState<RequestType>(null);
  const [connectionRequest, setConnectionRequest] = useState<ConnectionRequest | null>(null);
  const [capabilityRequest, setCapabilityRequest] = useState<CapabilityRequest | null>(null);
  const [invokeRequest, setInvokeRequest] = useState<InvokeRequest | null>(null);
  const [parsedTxPayload, setParsedTxPayload] = useState<TransactionPayload | null>(null);
  const [parsedEvmTxPayload, setParsedEvmTxPayload] = useState<EVMTransactionPayload | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(wallets[0] || null);
  const [isProcessing, setIsProcessing] = useState(false);
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

  useEffect(() => {
    loadPendingRequest();
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

    // Check chrome storage for pending requests
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const pending = await chrome.storage.local.get([
        'pendingConnectionRequest',
        'pendingCapabilityRequest',
        'pendingInvokeRequest'
      ]);

      if (pending.pendingConnectionRequest) {
        setRequestType('connection');
        setConnectionRequest(pending.pendingConnectionRequest);
      } else if (pending.pendingCapabilityRequest) {
        setRequestType('capability');
        setCapabilityRequest(pending.pendingCapabilityRequest);
      } else if (pending.pendingInvokeRequest) {
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
              console.log('[DAppRequestHandler] Parsed tx payload:', txParams);
            }
          } catch (e) {
            console.error('[DAppRequestHandler] Failed to parse tx payload for display:', e);
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
              console.log('[DAppRequestHandler] Parsed EVM tx payload:', evmTxParams);
            }
          } catch (e) {
            console.error('[DAppRequestHandler] Failed to parse EVM tx payload for display:', e);
          }
        }
      }
    }
  };

  const handleConnectionApprove = async () => {
    if (!connectionRequest) return;
    
    // Ensure we have a wallet selected
    if (!selectedWallet) {
      console.error('No wallet selected for connection approval');
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
            console.log('[DAppRequestHandler] Network from active RPC provider:', currentNetwork);
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
      
      console.log('[DAppRequestHandler] Final network:', currentNetwork);
      
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
        // Get EVM address from storage (safe - no private key needed)
        const evmAddress = WalletManager.getEvmAddress(selectedWallet.address);
        console.log('[DAppRequestHandler] Got EVM address from storage:', {
          octraAddress: selectedWallet.address,
          evmAddress: evmAddress || '(not found)'
        });

        console.log('[DAppRequestHandler] Sending CONNECTION_RESULT:', {
          appOrigin: connectionRequest.appOrigin,
          walletPubKey: selectedWallet.address,
          evmAddress,
          network: currentNetwork
        });
        
        chrome.runtime.sendMessage({
          type: 'CONNECTION_RESULT',
          appOrigin: connectionRequest.appOrigin,
          origin: connectionRequest.appOrigin, // For compatibility
          approved: true,
          walletPubKey: selectedWallet.address,
          address: selectedWallet.address, // For compatibility
          evmAddress, // EVM address from storage
          network: currentNetwork
        });
        chrome.storage.local.remove('pendingConnectionRequest');
      }

      toast({ title: 'Connected', description: `Connected to ${connectionRequest.appName || 'dApp'}` });
      window.close();
    } catch (error) {
      console.error('Connection error:', error);
      setIsProcessing(false);
    }
  };

  const handleCapabilityApprove = async () => {
    if (!capabilityRequest || !selectedWallet) {
      console.error('[DAppRequestHandler] Missing capabilityRequest or selectedWallet');
      return;
    }
    
    console.log('[DAppRequestHandler] Starting capability approval...');
    console.log('[DAppRequestHandler] Capability request:', capabilityRequest);
    console.log('[DAppRequestHandler] Selected wallet address:', selectedWallet.address);
    // SECURITY: Do not log private key details
    console.log('[DAppRequestHandler] Wallet ready for signing:', !!selectedWallet.privateKey);
    
    // Validate private key exists
    if (!selectedWallet.privateKey) {
      console.error('[DAppRequestHandler] ERROR: Wallet has no private key!');
      console.error('[DAppRequestHandler] Wallet object keys:', Object.keys(selectedWallet));
      toast({ 
        title: 'Error', 
        description: 'Wallet private key not available. Please unlock your wallet.', 
        variant: 'destructive' 
      });
      return;
    }
    
    setIsProcessing(true);

    try {
      // Build capability payload (expiresAt is mandatory in v1)
      const now = Date.now();
      const defaultTTL = 24 * 60 * 60 * 1000; // 24 hours default
      const payload: CapabilityPayload = {
        version: 1,
        circle: capabilityRequest.circle,
        methods: capabilityRequest.methods,
        scope: capabilityRequest.scope,
        encrypted: capabilityRequest.encrypted,
        appOrigin: capabilityRequest.appOrigin,
        issuedAt: now,
        expiresAt: capabilityRequest.ttlSeconds 
          ? now + capabilityRequest.ttlSeconds * 1000 
          : now + defaultTTL, // Default 24h if not specified
        nonce: generateNonce()
      };

      console.log('[DAppRequestHandler] Capability payload:', payload);

      // Sign capability with wallet's private key
      console.log('[DAppRequestHandler] Calling signCapability...');
      const signedCapability = await signCapability(payload, selectedWallet.privateKey);
      
      console.log('[DAppRequestHandler] Capability signed successfully!');
      
      // Create capability ID
      const capabilityId = createCapabilityId(signedCapability);
      
      console.log('[DAppRequestHandler] Signed capability:', {
        id: capabilityId,
        issuerPubKey: signedCapability.issuerPubKey,
        signature: signedCapability.signature.slice(0, 32) + '...',
        fullSignature: signedCapability.signature
      });

      // Send response with full signed capability
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        console.log('[DAppRequestHandler] Sending CAPABILITY_RESULT to background...');
        
        const message = {
          type: 'CAPABILITY_RESULT',
          appOrigin: capabilityRequest.appOrigin,
          approved: true,
          capabilityId,
          signedCapability
        };
        
        console.log('[DAppRequestHandler] Message to send:', message);
        
        chrome.runtime.sendMessage(message, (response) => {
          console.log('[DAppRequestHandler] Background response:', response);
          if (chrome.runtime.lastError) {
            console.error('[DAppRequestHandler] Chrome runtime error:', chrome.runtime.lastError);
          }
        });
        
        await chrome.storage.local.remove('pendingCapabilityRequest');
        console.log('[DAppRequestHandler] Removed pendingCapabilityRequest from storage');
      }

      toast({ title: 'Capability Granted', description: `Granted ${capabilityRequest.scope} access` });
      
      console.log('[DAppRequestHandler] Closing window...');
      setTimeout(() => {
        window.close();
      }, 500); // Small delay to ensure message is sent
    } catch (error) {
      console.error('[DAppRequestHandler] Capability error:', error);
      console.error('[DAppRequestHandler] Error stack:', error instanceof Error ? error.stack : 'No stack');
      toast({ title: 'Error', description: `Failed to sign capability: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  const handleInvokeApprove = async () => {
    if (!invokeRequest || !selectedWallet) return;
    setIsProcessing(true);

    try {
      console.log('[DAppRequestHandler] Processing invoke:', invokeRequest.method);
      
      // Handle send_transaction method - use existing wallet transaction functions
      if (invokeRequest.method === 'send_transaction') {
        console.log('[DAppRequestHandler] Executing send_transaction...');
        
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
          console.error('[DAppRequestHandler] Failed to parse tx payload:', e);
          throw new Error('Failed to parse transaction payload');
        }
        
        console.log('[DAppRequestHandler] Transaction params:', txParams);
        console.log('[DAppRequestHandler]   to:', txParams.to);
        console.log('[DAppRequestHandler]   amount:', txParams.amount);
        console.log('[DAppRequestHandler]   message:', txParams.message ? '(present)' : '(empty)');
        
        // Validate wallet has private key
        if (!selectedWallet.privateKey) {
          throw new Error('Wallet private key not available. Please unlock your wallet.');
        }
        
        // Get current nonce and add 1 for new transaction
        // IMPORTANT: Force refresh to get latest nonce from chain, not cached
        console.log('[DAppRequestHandler] Fetching nonce for:', selectedWallet.address);
        const balanceData = await fetchBalance(selectedWallet.address, true); // Force refresh!
        const currentNonce = balanceData.nonce;
        const txNonce = currentNonce + 1; // IMPORTANT: nonce must be current + 1
        
        // Derive public key from private key using nacl
        const privateKeyBuffer = Buffer.from(selectedWallet.privateKey, 'base64');
        const keyPair = nacl.sign.keyPair.fromSeed(privateKeyBuffer.slice(0, 32));
        const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
        
        console.log('[DAppRequestHandler] Creating transaction...');
        console.log('[DAppRequestHandler]   currentNonce:', currentNonce);
        console.log('[DAppRequestHandler]   txNonce (current+1):', txNonce);
        
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
        
        console.log('[DAppRequestHandler] Sending transaction to Octra chain...');
        const txResult = await sendTransaction(transaction);
        
        console.log('[DAppRequestHandler] Transaction result:', txResult);
        
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
        
        console.log('[DAppRequestHandler] ✅ Transaction sent! txHash:', txResult.hash);
        
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'INVOKE_RESULT',
            appOrigin: invokeRequest.appOrigin,
            approved: true,
            data: new TextEncoder().encode(JSON.stringify(resultData))
          });
          chrome.storage.local.remove('pendingInvokeRequest');
        }
        
        toast({ 
          title: 'Transaction Sent', 
          description: `Sent ${txParams.amount} OCT to ${txParams.to.slice(0, 12)}...` 
        });
      } else if (invokeRequest.method === 'send_evm_transaction') {
        // Handle EVM transaction (ETH on Sepolia)
        console.log('[DAppRequestHandler] Executing send_evm_transaction...');
        
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
          console.error('[DAppRequestHandler] Failed to parse EVM tx payload:', e);
          throw new Error('Failed to parse EVM transaction payload');
        }
        
        console.log('[DAppRequestHandler] EVM Transaction params:', evmTxParams);
        console.log('[DAppRequestHandler]   to:', evmTxParams.to);
        console.log('[DAppRequestHandler]   amount:', evmTxParams.amount, 'ETH');
        console.log('[DAppRequestHandler]   data:', evmTxParams.data ? '(present)' : '(empty)');
        
        // Validate wallet has private key
        if (!selectedWallet.privateKey) {
          throw new Error('Wallet private key not available. Please unlock your wallet.');
        }
        
        // Get EVM private key from WalletManager (async - retrieves from session)
        const evmPrivateKey = await WalletManager.getEvmPrivateKey(selectedWallet.address);
        if (!evmPrivateKey) {
          throw new Error('EVM private key not found. Please re-import your wallet.');
        }
        
        console.log('[DAppRequestHandler] Sending EVM transaction to Sepolia...');
        
        // Send EVM transaction using sendEVMTransaction
        const txHash = await sendEVMTransaction(
          evmPrivateKey,
          evmTxParams.to,
          evmTxParams.amount,
          'eth-sepolia', // Network ID for Sepolia
          evmTxParams.data // Intent payload as hex data
        );
        
        console.log('[DAppRequestHandler] ✅ EVM Transaction sent! txHash:', txHash);
        
        // Return the result to dApp
        const resultData = {
          success: true,
          txHash,
          from: WalletManager.getEvmAddress(selectedWallet.address),
          to: evmTxParams.to,
          amount: evmTxParams.amount,
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
        
        toast({ 
          title: 'ETH Transaction Sent', 
          description: `Sent ${evmTxParams.amount} ETH to ${evmTxParams.to.slice(0, 12)}...` 
        });
      } else {
        // For other methods, return mock success (to be implemented)
        console.log('[DAppRequestHandler] Executing other method:', invokeRequest.method);
        
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'INVOKE_RESULT',
            appOrigin: invokeRequest.appOrigin,
            approved: true,
            data: new Uint8Array([1, 2, 3])
          });
          chrome.storage.local.remove('pendingInvokeRequest');
        }
        
        toast({ title: 'Invocation Complete', description: `Executed ${invokeRequest.method}` });
      }
      
      window.close();
    } catch (error) {
      console.error('[DAppRequestHandler] Invoke error:', error);
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
    <div className="h-full flex flex-col p-3">
      <Card className="border-0 shadow-none flex-1 flex flex-col">
        <CardHeader className="text-center pb-2 pt-1 space-y-1">
          {/* App Icon */}
          <div className="flex justify-center mb-1">
            <Avatar className="h-10 w-10">
              {(connectionRequest?.appIcon || capabilityRequest?.appIcon) && (
                <AvatarImage src={connectionRequest?.appIcon || capabilityRequest?.appIcon} />
              )}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {requestType === 'connection' && <Globe className="h-5 w-5" />}
                {requestType === 'capability' && <Shield className="h-5 w-5" />}
                {requestType === 'invoke' && <Zap className="h-5 w-5" />}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Title */}
          <CardTitle className="text-base">
            {requestType === 'connection' && 'Connection Request'}
            {requestType === 'capability' && 'Capability Request'}
            {requestType === 'invoke' && 'Invoke Request'}
          </CardTitle>

          {/* App Info */}
          <p className="text-sm font-medium text-foreground truncate">
            {connectionRequest?.appName || capabilityRequest?.appName || invokeRequest?.appName || 'Octra DEX'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {connectionRequest?.appOrigin || capabilityRequest?.appOrigin || invokeRequest?.appOrigin}
          </p>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col space-y-2 overflow-hidden pt-0">
          {/* Connection Request */}
          {requestType === 'connection' && connectionRequest && (
            <>
              <div className="p-2 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Globe className="h-3 w-3" />
                  <span className="font-medium text-sm">Circle</span>
                </div>
                <p className="text-xs font-mono truncate">{connectionRequest.circle}</p>
              </div>

              <div className="space-y-2">
                <h3 className="font-medium text-sm">Select Account</h3>
                <select
                  className="w-full p-2 border rounded-lg bg-background text-sm"
                  value={selectedWallet?.address || ''}
                  onChange={(e) => {
                    const wallet = wallets.find(w => w.address === e.target.value);
                    if (wallet) setSelectedWallet(wallet);
                  }}
                >
                  {wallets.map((wallet, index) => (
                    <option key={wallet.address} value={wallet.address}>
                      Account {index + 1} - {truncateAddress(wallet.address)}
                    </option>
                  ))}
                </select>
              </div>

              <Alert className="py-2">
                <Shield className="h-3 w-3" />
                <AlertDescription className="text-xs">
                  This will create a session. No authority is granted until you approve capabilities.
                </AlertDescription>
              </Alert>
            </>
          )}

          {/* Capability Request */}
          {requestType === 'capability' && capabilityRequest && (
            <>
              <div className="p-2 bg-muted rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Circle</span>
                  <span className="font-mono text-xs truncate max-w-[180px]">{capabilityRequest.circle}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Scope</span>
                  <Badge className={`${getScopeColor(capabilityRequest.scope)} text-xs py-0`}>
                    {getScopeIcon(capabilityRequest.scope)}
                    <span className="ml-1">{capabilityRequest.scope}</span>
                  </Badge>
                </div>
                {capabilityRequest.encrypted && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Encrypted</span>
                    <Badge variant="secondary" className="text-xs py-0">
                      <Lock className="h-3 w-3 mr-1" />
                      Yes
                    </Badge>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-hidden">
                <h3 className="font-medium text-sm mb-1">Requested Methods</h3>
                <div className="space-y-1 max-h-[120px] overflow-y-auto">
                  {capabilityRequest.methods.map((method, i) => (
                    <div key={i} className="flex items-center gap-2 p-1.5 bg-muted rounded text-xs">
                      <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                      <span className="font-mono truncate">{method}</span>
                    </div>
                  ))}
                </div>
              </div>

              {capabilityRequest.scope === 'write' || capabilityRequest.scope === 'compute' ? (
                <Alert className="border-amber-200 bg-amber-50 py-2">
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                  <AlertDescription className="text-xs text-amber-800">
                    This allows {capabilityRequest.scope} operations. Only approve if you trust this app.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="py-2">
                  <Shield className="h-3 w-3" />
                  <AlertDescription className="text-xs">
                    This capability only allows read operations.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {/* Invoke Request */}
          {requestType === 'invoke' && invokeRequest && (
            <>
              <div className="p-2 bg-muted rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Method</span>
                  <span className="font-mono font-medium text-sm">{invokeRequest.method}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Circle</span>
                  <span className="font-mono text-xs truncate max-w-[180px]">{invokeRequest.capability.circle}</span>
                </div>
              </div>

              {/* Transaction Details for send_transaction */}
              {invokeRequest.method === 'send_transaction' && parsedTxPayload && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                  <h4 className="font-medium text-sm text-amber-800">Transaction Details</h4>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-amber-700">To</span>
                      <span className="font-mono text-xs text-amber-900 truncate max-w-[180px]">{parsedTxPayload.to}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-amber-700">Amount</span>
                      <span className="font-bold text-sm text-amber-900">{parsedTxPayload.amount} OCT</span>
                    </div>
                    {parsedTxPayload.message && (
                      <div className="pt-1 border-t border-amber-200">
                        <span className="text-xs text-amber-700">Message (Intent Payload)</span>
                        <div className="mt-1 p-1 bg-amber-100 rounded text-xs font-mono text-amber-800 max-h-[60px] overflow-y-auto break-all">
                          {parsedTxPayload.message.length > 100 
                            ? parsedTxPayload.message.slice(0, 100) + '...' 
                            : parsedTxPayload.message}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* EVM Transaction Details for send_evm_transaction */}
              {invokeRequest.method === 'send_evm_transaction' && parsedEvmTxPayload && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                  <h4 className="font-medium text-sm text-blue-800">ETH Transaction Details</h4>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-700">Network</span>
                      <span className="font-medium text-xs text-blue-900">Sepolia Testnet</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-700">To</span>
                      <span className="font-mono text-xs text-blue-900 truncate max-w-[180px]">{parsedEvmTxPayload.to}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-700">Amount</span>
                      <span className="font-bold text-sm text-blue-900">{parsedEvmTxPayload.amount} ETH</span>
                    </div>
                    {parsedEvmTxPayload.data && (
                      <div className="pt-1 border-t border-blue-200">
                        <span className="text-xs text-blue-700">Data (Intent Payload)</span>
                        <div className="mt-1 p-1 bg-blue-100 rounded text-xs font-mono text-blue-800 max-h-[60px] overflow-y-auto break-all">
                          {parsedEvmTxPayload.data.length > 100 
                            ? parsedEvmTxPayload.data.slice(0, 100) + '...' 
                            : parsedEvmTxPayload.data}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Alert className={invokeRequest.method === 'send_transaction' || invokeRequest.method === 'send_evm_transaction' ? "border-amber-200 bg-amber-50 py-2" : "py-2"}>
                {invokeRequest.method === 'send_transaction' ? (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    <AlertDescription className="text-xs text-amber-800">
                      This will send OCT from your wallet. Make sure you trust this dApp.
                    </AlertDescription>
                  </>
                ) : invokeRequest.method === 'send_evm_transaction' ? (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    <AlertDescription className="text-xs text-amber-800">
                      This will send ETH from your wallet on Sepolia. Make sure you trust this dApp.
                    </AlertDescription>
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    <AlertDescription className="text-xs">
                      This will execute the method using your granted capability.
                    </AlertDescription>
                  </>
                )}
              </Alert>
            </>
          )}

          {/* Spacer to push buttons to bottom */}
          <div className="flex-1 min-h-2" />

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1 h-9"
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              onClick={() => {
                console.log('[DAppRequestHandler] Approve clicked, requestType:', requestType, 'selectedWallet:', selectedWallet?.address);
                if (requestType === 'connection') handleConnectionApprove();
                else if (requestType === 'capability') handleCapabilityApprove();
                else if (requestType === 'invoke') handleInvokeApprove();
              }}
              disabled={isProcessing || !selectedWallet}
              className="flex-1 h-9"
            >
              <Check className="h-4 w-4 mr-1" />
              {isProcessing ? 'Processing...' : !selectedWallet ? 'Loading...' : 'Approve'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
