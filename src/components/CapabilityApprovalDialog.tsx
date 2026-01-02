/**
 * CapabilityApprovalDialog - Dialog for displaying and approving capability requests
 * 
 * Requirements: 5.2
 */

import React, { useState } from 'react';
import { Shield, Check, X, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  WalletCapability,
  CapabilityRequest,
  CAPABILITY_DESCRIPTIONS,
} from '../permissions/types';

interface CapabilityApprovalDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog is closed */
  onOpenChange: (open: boolean) => void;
  /** The capability request to display */
  request: CapabilityRequest | null;
  /** Callback when user approves capabilities */
  onApprove: (capabilities: WalletCapability[]) => void;
  /** Callback when user denies the request */
  onDeny: () => void;
}

const capabilityIcons: Record<WalletCapability, string> = {
  tx_sign: '✍️',
  runtime_execute: '⚡',
  decrypt_result: '🔓',
  reencrypt_for_third_party: '🔄',
  view_address: '👁️',
  view_balance: '💰',
};

const capabilityRiskLevel: Record<WalletCapability, 'low' | 'medium' | 'high'> = {
  view_address: 'low',
  view_balance: 'low',
  tx_sign: 'high',
  runtime_execute: 'medium',
  decrypt_result: 'medium',
  reencrypt_for_third_party: 'high',
};

export function CapabilityApprovalDialog({
  open,
  onOpenChange,
  request,
  onApprove,
  onDeny,
}: CapabilityApprovalDialogProps) {
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<WalletCapability>>(
    new Set()
  );

  // Reset selection when request changes
  React.useEffect(() => {
    if (request) {
      setSelectedCapabilities(new Set(request.capabilities));
    }
  }, [request]);

  if (!request) return null;

  const handleToggleCapability = (capability: WalletCapability) => {
    const newSelected = new Set(selectedCapabilities);
    if (newSelected.has(capability)) {
      newSelected.delete(capability);
    } else {
      newSelected.add(capability);
    }
    setSelectedCapabilities(newSelected);
  };

  const handleApprove = () => {
    onApprove(Array.from(selectedCapabilities));
    onOpenChange(false);
  };

  const handleDeny = () => {
    onDeny();
    onOpenChange(false);
  };

  const getRiskBadge = (risk: 'low' | 'medium' | 'high') => {
    const variants = {
      low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded ${variants[risk]}`}>
        {risk}
      </span>
    );
  };

  const hasHighRiskCapabilities = request.capabilities.some(
    (c) => capabilityRiskLevel[c] === 'high'
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Permission Request
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{request.appName}</span> is requesting
            access to your wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* App Info */}
          <div className="flex items-center gap-3 p-3 bg-muted ">
            <Avatar className="h-10 w-10">
              {request.appIcon && <AvatarImage src={request.appIcon} />}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {request.appName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{request.appName}</div>
              <div className="text-sm text-muted-foreground truncate">
                {request.origin}
              </div>
            </div>
          </div>

          {/* High Risk Warning */}
          {hasHighRiskCapabilities && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950  border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                This app is requesting high-risk permissions. Only approve if you
                trust this application.
              </p>
            </div>
          )}

          {/* Capabilities List */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Requested Permissions:</p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {request.capabilities.map((capability) => (
                <div
                  key={capability}
                  className="flex items-start gap-3 p-2  hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleToggleCapability(capability)}
                >
                  <Checkbox
                    checked={selectedCapabilities.has(capability)}
                    onCheckedChange={() => handleToggleCapability(capability)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span>{capabilityIcons[capability]}</span>
                      <span className="text-sm font-medium capitalize">
                        {capability.replace(/_/g, ' ')}
                      </span>
                      {getRiskBadge(capabilityRiskLevel[capability])}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {CAPABILITY_DESCRIPTIONS[capability]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleDeny} className="flex-1">
            <X className="h-4 w-4 mr-2" />
            Deny
          </Button>
          <Button
            onClick={handleApprove}
            disabled={selectedCapabilities.size === 0}
            className="flex-1"
          >
            <Check className="h-4 w-4 mr-2" />
            Approve ({selectedCapabilities.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
