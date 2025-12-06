import React, { useState } from 'react';
import { DAppConnection } from './DAppConnection';
import { Wallet } from '../types/wallet';

interface ConnectionApprovalProps {
  request: {
    origin: string;
    appName: string;
    appIcon: string;
    permissions: string[];
  };
  wallets: Wallet[];  // Changed to support multiple wallets
  onApprove: (approved: boolean, selectedAddress?: string) => void;
}

export function ConnectionApproval({ request, wallets, onApprove }: ConnectionApprovalProps) {
  // Initialize with first wallet or null if no wallets
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(wallets.length > 0 ? wallets[0] : null);

  // Convert request to DAppConnectionRequest format
  const connectionRequest = {
    origin: request.origin,
    appName: request.appName,
    appIcon: request.appIcon,
    permissions: request.permissions
  };

  const handleApprove = (wallet: Wallet) => {
    onApprove(true, wallet.address);
  };

  const handleReject = () => {
    onApprove(false);
  };

  return (
    <DAppConnection
      connectionRequest={connectionRequest}
      wallets={wallets}  // Pass all available wallets
      selectedWallet={selectedWallet}
      onWalletSelect={setSelectedWallet}
      onApprove={handleApprove}
      onReject={handleReject}
    />
  );
}