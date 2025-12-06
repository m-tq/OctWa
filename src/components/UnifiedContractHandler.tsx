import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Code, 
  Eye,
  Send,
  Shield,
  Check,
  AlertTriangle,
  Calculator,
  Settings,
  Zap,
  X
} from 'lucide-react';
import { Wallet } from '../types/wallet';
import { fetchBalance } from '../utils/api';
import { useToast } from '@/hooks/use-toast';
import * as nacl from 'tweetnacl';

export interface ContractMethod {
  name: string;
  type: 'view' | 'call';
  params: ContractParameter[];
  description?: string;
  gasEstimate?: number;
}

export interface ContractParameter {
  name: string;
  type: string;
  value?: any;
  description?: string;
  example?: string;
  required?: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ContractInteractionRequest {
  origin: string;
  contractAddress: string;
  method: ContractMethod;
  appName?: string;
  result?: any;
  txHash?: string;
  error?: string;
  appIcon?: string;
  value?: string; // For payable methods
  gasLimit?: number;
  gasPrice?: number;
}

interface ContractInteractionHistory {
  type: 'view' | 'call';
  contractAddress: string;
  methodName: string;
  params: string[];
  timestamp: number;
  success: boolean;
  walletAddress: string;
  result?: any;
  error?: string;
  txHash?: string;
}

interface UnifiedContractHandlerProps {
  request: ContractInteractionRequest;
  wallets: Wallet[];
  selectedWallet: Wallet | null;
  connectedWallet?: Wallet | null;
  onWalletSelect: (wallet: Wallet) => void;
  onApprove: (result: any) => void;
  onReject: (error?: string) => void;
}

export function UnifiedContractHandler({ 
  request, 
  wallets, 
  selectedWallet, 
  connectedWallet,
  onWalletSelect, 
  onApprove, 
  onReject 
}: UnifiedContractHandlerProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [parameterValues, setParameterValues] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [customGasLimit, setCustomGasLimit] = useState<string>('');
  const [customGasPrice, setCustomGasPrice] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { toast } = useToast();

  // Get active RPC URL
  const getActiveRPCUrl = (): string => {
    try {
      const providers = JSON.parse(localStorage.getItem('rpcProviders') || '[]');
      const activeProvider = providers.find((p: any) => p.isActive);
      return activeProvider?.url || 'https://octra.network';
    } catch {
      return 'https://octra.network';
    }
  };

  // Initialize parameter values
  useEffect(() => {
    const initialValues: Record<string, any> = {};
    request.method.params.forEach(param => {
      if (param.value !== undefined) {
        initialValues[param.name] = param.value;
      } else if (param.example) {
        initialValues[param.name] = param.example;
      } else {
        initialValues[param.name] = '';
      }
    });
    setParameterValues(initialValues);
  }, [request.method.params]);
  // Ensure connected wallet is used when provided
  useEffect(() => {
    if (connectedWallet && selectedWallet?.address !== connectedWallet.address) {
      onWalletSelect(connectedWallet);
    }
  }, [connectedWallet, selectedWallet, onWalletSelect]);

  // Fetch balance when wallet is selected
  useEffect(() => {
    if (selectedWallet) {
      setIsLoadingBalance(true);
      fetchBalance(selectedWallet.address)
        .then(data => {
          setBalance(data.balance);
          setNonce(data.nonce);
        })
        .catch(error => {
          console.error('Failed to fetch balance:', error);
          toast({
            title: "Error",
            description: "Failed to fetch wallet balance",
            variant: "destructive",
          });
        })
        .finally(() => setIsLoadingBalance(false));
    }
  }, [selectedWallet, toast]);

  // Contract interaction functions
  const viewCall = async (
    contractAddress: string,
    methodName: string,
    params: string[],
    callerAddress: string
  ): Promise<any> => {
    const rpcUrl = getActiveRPCUrl();
    
    try {
      const response = await fetch(`${rpcUrl}/contract/call-view`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contract: contractAddress,
          method: methodName,
          params: params,
          caller: callerAddress
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status === 'success') {
        return { success: true, result: data.result };
      } else {
        return { success: false, error: data.error || 'Contract call failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const callContract = async (
    contractAddress: string,
    methodName: string,
    params: string[],
    callerAddress: string,
    privateKey: string,
    publicKey: string,
    nonce: number,
    gasLimit?: number,
    gasPrice?: number,
    value?: string
  ): Promise<any> => {
    const rpcUrl = getActiveRPCUrl();
    const timestamp = Date.now() / 1000;
    
    try {
      // Create signature for contract call (adapted from main.rs)
      const signatureData = {
        from: callerAddress,
        to_: contractAddress,
        amount: value || '0',
        nonce: nonce,
        ou: '1',
        timestamp: timestamp
      };
      
      const signature = await signTransaction(signatureData, privateKey, publicKey);
      
      const response = await fetch(`${rpcUrl}/call-contract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contract: contractAddress,
          method: methodName,
          params: params,
          caller: callerAddress,
          nonce: nonce,
          timestamp: timestamp,
          signature: signature,
          public_key: publicKey,
          gas_limit: gasLimit,
          gas_price: gasPrice
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, txHash: data.tx_hash };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  // Proper signature function adapted from main.rs
  const signTransaction = async (data: any, privateKeyBase64: string, publicKeyHex: string): Promise<string> => {
    try {
      // Create the signing blob exactly like main.rs
      const blob = JSON.stringify({
        from: data.from,
        to_: data.to_,
        amount: data.amount,
        nonce: data.nonce,
        ou: data.ou,
        timestamp: data.timestamp
      });
      
      // Convert keys to proper format
      const privateKeyBuffer = Buffer.from(privateKeyBase64, 'base64');
      const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
      
      // Create secret key for nacl (64 bytes: 32 private + 32 public)
      const secretKey = new Uint8Array(64);
      secretKey.set(privateKeyBuffer, 0);
      secretKey.set(publicKeyBuffer, 32);
      
      // Sign the blob
      const signature = nacl.sign.detached(new TextEncoder().encode(blob), secretKey);
      
      return Buffer.from(signature).toString('base64');
    } catch (error) {
      console.error('Signing error:', error);
      throw new Error('Failed to sign transaction');
    }
  };

  const validateParameters = (): boolean => {
    const errors: Record<string, string> = {};
    let isValid = true;

    request.method.params.forEach(param => {
      const value = parameterValues[param.name];
      
      if (param.required !== false && (!value || value === '')) {
        errors[param.name] = `${param.name} is required`;
        isValid = false;
        return;
      }

      if (!value && param.required === false) {
        return;
      }

      // Type validation
      switch (param.type) {
        case 'number':
        case 'uint256':
        case 'int256':
          const numValue = Number(value);
          if (isNaN(numValue)) {
            errors[param.name] = `${param.name} must be a valid number`;
            isValid = false;
          } else {
            if (param.validation?.min !== undefined && numValue < param.validation.min) {
              errors[param.name] = `${param.name} must be at least ${param.validation.min}`;
              isValid = false;
            }
            if (param.validation?.max !== undefined && numValue > param.validation.max) {
              errors[param.name] = `${param.name} must not exceed ${param.validation.max}`;
              isValid = false;
            }
          }
          break;
          
        case 'address':
          if (typeof value !== 'string' || !isValidAddress(value)) {
            errors[param.name] = `${param.name} must be a valid address`;
            isValid = false;
          }
          break;
          
        case 'string':
          if (param.validation?.pattern) {
            const regex = new RegExp(param.validation.pattern);
            if (!regex.test(value)) {
              errors[param.name] = `${param.name} format is invalid`;
              isValid = false;
            }
          }
          break;
      }
    });

    setValidationErrors(errors);
    return isValid;
  };

  const isValidAddress = (address: string): boolean => {
    return typeof address === 'string' && 
           address.length > 0 && 
           (address.startsWith('oct') || address.startsWith('0x'));
  };

  const calculateEstimatedCost = (): number => {
    const gasLimit = customGasLimit ? parseInt(customGasLimit) : (request.gasLimit || 100000);
    const gasPrice = customGasPrice ? parseFloat(customGasPrice) : (request.gasPrice || 0.001);
    const value = request.value ? parseFloat(request.value) : 0;
    
    return (gasLimit * gasPrice / 1000000) + value;
  };

  const handleParameterChange = (paramName: string, value: any) => {
    setParameterValues(prev => ({
      ...prev,
      [paramName]: value
    }));
    
    if (validationErrors[paramName]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[paramName];
        return newErrors;
      });
    }
  };

  const handleApprove = async () => {
    if (!selectedWallet) {
      toast({
        title: "No Wallet Selected",
        description: "Please select a wallet to execute the contract method",
        variant: "destructive",
      });
      return;
    }

    if (!validateParameters()) {
      toast({
        title: "Invalid Parameters",
        description: "Please fix the parameter validation errors",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      const paramArray = request.method.params.map(param => 
        String(parameterValues[param.name] || '')
      );

      // Store contract interaction in history
      const contractInteraction: ContractInteractionHistory = {
        type: request.method.type,
        contractAddress: request.contractAddress,
        methodName: request.method.name,
        params: paramArray,
        timestamp: Date.now(),
        success: false,
        walletAddress: selectedWallet.address
      };

      if (request.method.type === 'view') {
        const result = await viewCall(
          request.contractAddress,
          request.method.name,
          paramArray,
          selectedWallet.address
        );
        
        if (result.success) {
          contractInteraction.success = true;
          contractInteraction.result = result.result;
          
          // Save to contract history
          saveContractInteraction(contractInteraction);
          
          toast({
            title: "View Call Successful",
            description: "Contract view method executed successfully",
          });
          onApprove({
            type: 'view',
            result: result.result,
            methodName: request.method.name
          });
        } else {
          contractInteraction.error = result.error;
          saveContractInteraction(contractInteraction);
          throw new Error(result.error);
        }
      } else {
        if (balance === null) {
          throw new Error("Unable to verify wallet balance");
        }

        const estimatedCost = calculateEstimatedCost();
        if (estimatedCost > balance) {
          throw new Error(`Insufficient balance. Need ${estimatedCost.toFixed(8)} OCT, but only have ${balance.toFixed(8)} OCT`);
        }

        const gasLimit = customGasLimit ? parseInt(customGasLimit) : (request.gasLimit || 100000);
        const gasPrice = customGasPrice ? parseFloat(customGasPrice) : (request.gasPrice || 0.001);

        const result = await callContract(
          request.contractAddress,
          request.method.name,
          paramArray,
          selectedWallet.address,
          selectedWallet.privateKey,
          selectedWallet.publicKey || '',
          nonce + 1,
          gasLimit,
          gasPrice,
          request.value
        );

        if (result.success) {
          contractInteraction.success = true;
          contractInteraction.txHash = result.txHash;
          
          // Save to contract history
          saveContractInteraction(contractInteraction);
          
          toast({
            title: "Contract Call Successful",
            description: "Contract method executed successfully",
          });
          onApprove({
            type: 'call',
            txHash: result.txHash,
            methodName: request.method.name
          });
        } else {
          contractInteraction.error = result.error;
          saveContractInteraction(contractInteraction);
          throw new Error(result.error);
        }
      }
    } catch (error: any) {
      console.error('Contract execution error:', error);
      toast({
        title: "Contract Execution Failed",
        description: error.message || "Failed to execute contract method",
        variant: "destructive",
      });
      onReject(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const saveContractInteraction = (interaction: ContractInteractionHistory) => {
    try {
      const existingHistory = JSON.parse(localStorage.getItem('contractHistory') || '[]');
      const updatedHistory = [interaction, ...existingHistory].slice(0, 100); // Keep last 100 interactions
      localStorage.setItem('contractHistory', JSON.stringify(updatedHistory));
    } catch (error) {
      console.error('Failed to save contract interaction:', error);
    }
  };

  const handleReject = () => {
    setIsProcessing(true);
    onReject("User rejected the contract call");
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  const estimatedCost = calculateEstimatedCost();
  const currentBalance = balance || 0;
  const canAfford = estimatedCost <= currentBalance;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              {request.appIcon ? (
                <Avatar className="h-16 w-16">
                  <AvatarImage src={request.appIcon} />
                  <AvatarFallback>
                    {request.appName?.charAt(0) || 'A'}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div className="h-16 w-16 bg-primary rounded-full flex items-center justify-center">
                  <Code className="h-8 w-8 text-primary-foreground" />
                </div>
              )}
            </div>
            <CardTitle className="text-xl">
              {request.appName || 'Unknown App'} wants to interact with a contract
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {request.origin}
            </p>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Contract Details */}
            <div className="space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <Code className="h-4 w-4" />
                Contract Method Details
              </h3>
              <div className="space-y-3 p-4 bg-muted rounded-md">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Contract:</span>
                  <span className="font-mono text-sm">{truncateAddress(request.contractAddress)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Method:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{request.method.name}</span>
                    <Badge variant={request.method.type === 'view' ? 'secondary' : 'default'}>
                      {request.method.type === 'view' ? (
                        <><Eye className="h-3 w-3 mr-1" />View</>
                      ) : (
                        <><Send className="h-3 w-3 mr-1" />Call</>
                      )}
                    </Badge>
                  </div>
                </div>
                {request.method.description && (
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Description:</span>
                    <p className="text-sm">{request.method.description}</p>
                  </div>
                )}
                {request.method.type === 'call' && (
                  <>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Estimated Cost:</span>
                      <span className={`font-mono font-medium ${canAfford ? 'text-green-600' : 'text-red-600'}`}>
                        {estimatedCost.toFixed(8)} OCT
                      </span>
                    </div>
                    {request.value && parseFloat(request.value) > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Value:</span>
                        <span className="font-mono font-medium">{request.value} OCT</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Parameters */}
            {request.method.params.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Method Parameters
                </h3>
                <div className="space-y-4">
                  {request.method.params.map((param) => (
                    <div key={param.name} className="space-y-2">
                      <Label htmlFor={param.name} className="text-sm font-medium">
                        {param.name}
                        {param.required !== false && <span className="text-red-500 ml-1">*</span>}
                        <span className="text-muted-foreground ml-2">({param.type})</span>
                      </Label>
                      {param.description && (
                        <p className="text-xs text-muted-foreground">{param.description}</p>
                      )}
                      {param.type === 'string' && param.name.toLowerCase().includes('message') ? (
                        <Textarea
                          id={param.name}
                          value={parameterValues[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          placeholder={param.example || `Enter ${param.name}`}
                          className={validationErrors[param.name] ? 'border-red-500' : ''}
                        />
                      ) : (
                        <Input
                          id={param.name}
                          type={param.type === 'number' || param.type.includes('int') ? 'number' : 'text'}
                          value={parameterValues[param.name] || ''}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          placeholder={param.example || `Enter ${param.name}`}
                          className={validationErrors[param.name] ? 'border-red-500' : ''}
                          min={param.validation?.min}
                          max={param.validation?.max}
                        />
                      )}
                      {validationErrors[param.name] && (
                        <p className="text-red-500 text-xs">{validationErrors[param.name]}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced Settings for Call Methods */}
            {request.method.type === 'call' && (
              <div className="space-y-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full justify-between"
                >
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Advanced Settings
                  </span>
                  <span className="text-xs">{showAdvanced ? 'Hide' : 'Show'}</span>
                </Button>
                
                {showAdvanced && (
                  <div className="space-y-4 p-4 bg-muted rounded-md">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gasLimit" className="text-sm">Gas Limit</Label>
                        <Input
                          id="gasLimit"
                          type="number"
                          value={customGasLimit}
                          onChange={(e) => setCustomGasLimit(e.target.value)}
                          placeholder={String(request.gasLimit || 100000)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gasPrice" className="text-sm">Gas Price (OCT)</Label>
                        <Input
                          id="gasPrice"
                          type="number"
                          step="0.000001"
                          value={customGasPrice}
                          onChange={(e) => setCustomGasPrice(e.target.value)}
                          placeholder={String(request.gasPrice || 0.001)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Wallet Info */}
            {selectedWallet && (
              <div className="space-y-3">
                <h3 className="font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Wallet Info
                </h3>
                <div className="p-4 bg-muted rounded-md space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">From Address:</span>
                    <span className="font-mono text-sm">{truncateAddress(selectedWallet.address)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Current Balance:</span>
                    <span className="font-mono font-medium">
                      {isLoadingBalance ? (
                        "Loading..."
                      ) : (
                        `${balance?.toFixed(8) || '0.00000000'} OCT`
                      )}
                    </span>
                  </div>
                  {request.method.type === 'call' && !canAfford && balance !== null && (
                    <Alert className="mt-3">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Insufficient balance. You need {estimatedCost.toFixed(8)} OCT but only have {balance.toFixed(8)} OCT.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleReject}
                disabled={isProcessing}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                disabled={isProcessing || !selectedWallet || (request.method.type === 'call' && !canAfford)}
                className="flex-1"
              >
                {isProcessing ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </div>
                ) : (
                  <>
                    {request.method.type === 'view' ? (
                      <><Eye className="h-4 w-4 mr-2" />Execute View</>
                    ) : (
                      <><Zap className="h-4 w-4 mr-2" />Execute Call</>
                    )}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}