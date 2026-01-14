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

interface InvokeRequest {
  capabilityId: string;
  method: string;
  payload?: unknown;
  nonce: number;
  timestamp: number;
  appOrigin: string;
  capability: {
    circle: string;
    methods: string[];
    scope: string;
    encrypted: boolean;
  };
}

interface DAppRequestHandlerProps {
  wallets: Wallet[];
}

type RequestType = 'connection' | 'capability' | 'invoke' | null;

export function DAppRequestHandler({ wallets }: DAppRequestHandlerProps) {
  const [requestType, setRequestType] = useState<RequestType>(null);
  const [connectionRequest, setConnectionRequest] = useState<ConnectionRequest | null>(null);
  const [capabilityRequest, setCapabilityRequest] = useState<CapabilityRequest | null>(null);
  const [invokeRequest, setInvokeRequest] = useState<InvokeRequest | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(wallets[0] || null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

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
        console.log('[DAppRequestHandler] Sending CONNECTION_RESULT:', {
          appOrigin: connectionRequest.appOrigin,
          walletPubKey: selectedWallet.address,
          network: currentNetwork
        });
        
        chrome.runtime.sendMessage({
          type: 'CONNECTION_RESULT',
          appOrigin: connectionRequest.appOrigin,
          origin: connectionRequest.appOrigin, // For compatibility
          approved: true,
          walletPubKey: selectedWallet.address,
          address: selectedWallet.address, // For compatibility
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
    console.log('[DAppRequestHandler] Selected wallet has privateKey:', !!selectedWallet.privateKey);
    console.log('[DAppRequestHandler] Private key type:', typeof selectedWallet.privateKey);
    console.log('[DAppRequestHandler] Private key length:', selectedWallet.privateKey?.length || 0);
    
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
      // Build capability payload
      const now = Date.now();
      const payload: CapabilityPayload = {
        version: 1,
        circle: capabilityRequest.circle,
        methods: capabilityRequest.methods,
        scope: capabilityRequest.scope,
        encrypted: capabilityRequest.encrypted,
        appOrigin: capabilityRequest.appOrigin,
        issuedAt: now,
        expiresAt: capabilityRequest.ttlSeconds ? now + capabilityRequest.ttlSeconds * 1000 : undefined,
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
    if (!invokeRequest) return;
    setIsProcessing(true);

    try {
      // TODO: Execute actual invocation via network
      // For now, return mock success
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
      window.close();
    } catch (error) {
      console.error('Invoke error:', error);
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
    <div className="h-full flex flex-col p-4">
      <Card className="border-0 shadow-none flex-1 flex flex-col">
        <CardHeader className="text-center pb-3 pt-2">
          {/* App Icon */}
          <div className="flex justify-center mb-2">
            <Avatar className="h-12 w-12">
              {(connectionRequest?.appIcon || capabilityRequest?.appIcon) && (
                <AvatarImage src={connectionRequest?.appIcon || capabilityRequest?.appIcon} />
              )}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {requestType === 'connection' && <Globe className="h-6 w-6" />}
                {requestType === 'capability' && <Shield className="h-6 w-6" />}
                {requestType === 'invoke' && <Zap className="h-6 w-6" />}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Title */}
          <CardTitle className="text-lg">
            {requestType === 'connection' && 'Connection Request'}
            {requestType === 'capability' && 'Capability Request'}
            {requestType === 'invoke' && 'Invoke Request'}
          </CardTitle>

          {/* App Info */}
          <p className="text-sm text-muted-foreground truncate">
            {connectionRequest?.appName || capabilityRequest?.appName || 'Unknown App'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {connectionRequest?.appOrigin || capabilityRequest?.appOrigin || invokeRequest?.appOrigin}
          </p>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col space-y-3 overflow-hidden">
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
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Nonce</span>
                  <span className="font-mono text-xs">{invokeRequest.nonce}</span>
                </div>
              </div>

              <Alert className="py-2">
                <Zap className="h-3 w-3" />
                <AlertDescription className="text-xs">
                  This will execute the method using your granted capability.
                </AlertDescription>
              </Alert>
            </>
          )}

          {/* Spacer to push buttons to bottom */}
          <div className="flex-1" />

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1 h-10"
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              onClick={() => {
                if (requestType === 'connection') handleConnectionApprove();
                else if (requestType === 'capability') handleCapabilityApprove();
                else if (requestType === 'invoke') handleInvokeApprove();
              }}
              disabled={isProcessing || (requestType === 'connection' && !selectedWallet)}
              className="flex-1 h-10"
            >
              <Check className="h-4 w-4 mr-1" />
              {isProcessing ? 'Processing...' : 'Approve'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
