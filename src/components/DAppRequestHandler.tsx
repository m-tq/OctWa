import React, { useState, useEffect } from 'react';
import { DAppConnection } from './DAppConnection';
import { UnifiedContractHandler } from './UnifiedContractHandler';
import { Wallet, DAppConnectionRequest } from '../types/wallet';

// Updated contract request interface
export interface DAppContractRequest {
  origin: string;
  contractAddress: string;
  methodName: string;
  methodType: 'view' | 'call';
  params: ContractParameter[];
  appName?: string;
  appIcon?: string;
  gasLimit?: number;
  gasPrice?: number;
  value?: string;
  description?: string;
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

interface DAppRequestHandlerProps {
  wallets: Wallet[];
  contractRequest?: any;
  selectedWallet?: Wallet | null;
  onWalletSelect?: (wallet: Wallet) => void;
  onApprove?: (result: any) => void;
  onReject?: (error?: string) => void;
}

export function DAppRequestHandler({ 
  wallets, 
  contractRequest: propContractRequest,
  selectedWallet: propSelectedWallet,
  onWalletSelect: propOnWalletSelect,
  onApprove: propOnApprove,
  onReject: propOnReject
}: DAppRequestHandlerProps) {
  const [connectionRequest, setConnectionRequest] = useState<DAppConnectionRequest | null>(null);
  const [contractRequest, setContractRequest] = useState<DAppContractRequest | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    // If contract request is passed as prop (from popup), use it directly
    if (propContractRequest) {
      const unifiedRequest = {
        origin: propContractRequest.origin,
        appName: propContractRequest.appName,
        appIcon: propContractRequest.appIcon,
        contractAddress: propContractRequest.contractAddress,
        methodName: propContractRequest.methodName,
        methodType: propContractRequest.methodType,
        params: propContractRequest.params || [],
        gasLimit: propContractRequest.gasLimit,
        gasPrice: propContractRequest.gasPrice,
        value: propContractRequest.value,
        description: propContractRequest.description
      };
      
      setContractRequest(unifiedRequest);
      
      // Set connected wallet if provided
      if (propContractRequest.connectedAddress) {
        const wallet = wallets.find(w => w.address === propContractRequest.connectedAddress);
        if (wallet) {
          setConnectedWallet(wallet);
          if (propSelectedWallet) {
            setSelectedWallet(propSelectedWallet);
          } else {
            setSelectedWallet(wallet);
          }
        }
      }
      return;
    }
    
    // Parse URL parameters for dApp requests
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    
    if (action === 'connect') {
      const origin = urlParams.get('origin');
      const appName = urlParams.get('appName');
      const appIcon = urlParams.get('appIcon');
      const permissions = urlParams.get('permissions');
      
      if (origin) {
        setConnectionRequest({
          origin: decodeURIComponent(origin),
          appName: appName ? decodeURIComponent(appName) : undefined,
          appIcon: appIcon ? decodeURIComponent(appIcon) : undefined,
          permissions: permissions ? JSON.parse(decodeURIComponent(permissions)) : ['view_address']
        });
      }
    } else if (action === 'contract') {
      // Handle contract call requests
      const origin = urlParams.get('origin');
      const appName = urlParams.get('appName');
      const appIcon = urlParams.get('appIcon');
      const contractAddress = urlParams.get('contractAddress');
      const methodName = urlParams.get('methodName');
      const methodType = urlParams.get('methodType');
      const params = urlParams.get('params');
      const gasLimit = urlParams.get('gasLimit');
      const gasPrice = urlParams.get('gasPrice');
      const value = urlParams.get('value');
      const description = urlParams.get('description');
      const connectedAddress = urlParams.get('connectedAddress');
      
      if (origin && contractAddress && methodName && methodType) {
        try {
          const parsedParams = params ? JSON.parse(decodeURIComponent(params)) : [];
          
          setContractRequest({
            origin: decodeURIComponent(origin),
            appName: appName ? decodeURIComponent(appName) : undefined,
            appIcon: appIcon ? decodeURIComponent(appIcon) : undefined,
            contractAddress: decodeURIComponent(contractAddress),
            methodName: decodeURIComponent(methodName),
            methodType: decodeURIComponent(methodType) as 'view' | 'call',
            params: parsedParams,
            gasLimit: gasLimit ? parseInt(decodeURIComponent(gasLimit)) : undefined,
            gasPrice: gasPrice ? parseFloat(decodeURIComponent(gasPrice)) : undefined,
            value: value ? decodeURIComponent(value) : undefined,
            description: description ? decodeURIComponent(description) : undefined
          });
          
          // Set connected wallet if provided
          if (connectedAddress) {
            const wallet = wallets.find(w => w.address === decodeURIComponent(connectedAddress));
            if (wallet) {
              setConnectedWallet(wallet);
              setSelectedWallet(wallet);
            }
          }
        } catch (error) {
          console.error('Failed to parse contract request parameters:', error);
        }
      }
    } else if (action === 'transaction') {
      // Handle direct transactions as contract calls
      const origin = urlParams.get('origin');
      const appName = urlParams.get('appName');
      const appIcon = urlParams.get('appIcon');
      const to = urlParams.get('to');
      const amount = urlParams.get('amount');
      const message = urlParams.get('message');
      const connectedAddress = urlParams.get('connectedAddress');
      
      if (origin && to && amount) {
        // Convert transaction to contract format
        setContractRequest({
          origin: decodeURIComponent(origin),
          appName: appName ? decodeURIComponent(appName) : undefined,
          appIcon: appIcon ? decodeURIComponent(appIcon) : undefined,
          contractAddress: decodeURIComponent(to),
          methodName: 'transfer',
          methodType: 'call',
          params: [
            {
              name: 'amount',
              type: 'string',
              value: decodeURIComponent(amount),
              required: true,
              description: 'Amount to transfer in OCT'
            }
          ],
          value: decodeURIComponent(amount),
          description: message ? decodeURIComponent(message) : 'Direct transfer transaction'
        });
        
        // Set connected wallet if provided
        if (connectedAddress) {
          const wallet = wallets.find(w => w.address === decodeURIComponent(connectedAddress));
          if (wallet) {
            setConnectedWallet(wallet);
            setSelectedWallet(wallet);
          }
        }
      }
    }
  }, [wallets]);

  const handleConnectionApprove = async (wallet: Wallet) => {
    if (!connectionRequest) return;
    
    try {
      // Store connection in localStorage
      const connections = JSON.parse(localStorage.getItem('connectedDApps') || '[]');
      
      // Remove existing connection for this origin
      const filteredConnections = connections.filter((conn: any) => conn.origin !== connectionRequest.origin);
      
      const newConnection = {
        origin: connectionRequest.origin,
        appName: connectionRequest.appName || connectionRequest.origin,
        connectedAt: Date.now(),
        permissions: connectionRequest.permissions,
        selectedAddress: wallet.address
      };
      
      filteredConnections.push(newConnection);
      localStorage.setItem('connectedDApps', JSON.stringify(filteredConnections));
      
      // Send response to background script
      chrome.runtime.sendMessage({
        type: 'CONNECTION_RESULT',
        origin: connectionRequest.origin,
        approved: true,
        address: wallet.address
      });
      
      // Close tab
      window.close();
    } catch (error) {
      console.error('Connection approval error:', error);
    }
  };

  const handleConnectionReject = () => {
    if (!connectionRequest) return;
    
    // Send rejection response
    chrome.runtime.sendMessage({
      type: 'CONNECTION_RESULT',
      origin: connectionRequest.origin,
      approved: false
    });
    
    // Close tab
    window.close();
  };

  const handleContractApprove = (result: any) => {
    if (!contractRequest) return;
    
    if (propOnApprove) {
      // Use prop callback (popup mode)
      propOnApprove(result);
    } else {
      // Send success response (tab mode)
      chrome.runtime.sendMessage({
        type: 'CONTRACT_RESULT',
        origin: contractRequest.origin,
        approved: true,
        result: result
      });
      
      // Close tab
      window.close();
    }
  };

  const handleContractReject = (error?: string) => {
    if (!contractRequest) return;
    
    if (propOnReject) {
      // Use prop callback (popup mode)
      propOnReject(error);
    } else {
      // Send rejection response (tab mode)
      chrome.runtime.sendMessage({
        type: 'CONTRACT_RESULT',
        origin: contractRequest.origin,
        approved: false,
        error: error
      });
      
      // Close tab
      window.close();
    }
  };

  // Render connection request
  if (connectionRequest) {
    return (
      <DAppConnection
        connectionRequest={connectionRequest}
        wallets={wallets}
        selectedWallet={selectedWallet}
        onWalletSelect={setSelectedWallet}
        onApprove={handleConnectionApprove}
        onReject={handleConnectionReject}
      />
    );
  }

  // Render contract request using unified handler
  if (contractRequest) {
    // Convert to UnifiedContractHandler format
    const unifiedRequest = {
      origin: contractRequest.origin,
      appName: contractRequest.appName,
      appIcon: contractRequest.appIcon,
      contractAddress: contractRequest.contractAddress,
      method: {
        name: contractRequest.methodName,
        type: contractRequest.methodType,
        params: contractRequest.params.map(param => ({
          name: param.name,
          type: param.type,
          value: param.value,
          description: param.description,
          example: param.example,
          required: param.required,
          validation: param.validation
        })),
        description: contractRequest.description,
        gasEstimate: contractRequest.gasLimit
      },
      value: contractRequest.value,
      gasLimit: contractRequest.gasLimit,
      gasPrice: contractRequest.gasPrice
    };

    return (
      <UnifiedContractHandler
        request={unifiedRequest}
        wallets={wallets}
        selectedWallet={propSelectedWallet || selectedWallet}
        connectedWallet={connectedWallet}
        onWalletSelect={propOnWalletSelect || setSelectedWallet}
        onApprove={handleContractApprove}
        onReject={handleContractReject}
      />
    );
  }

  // No dApp request, return null
  return null;
}