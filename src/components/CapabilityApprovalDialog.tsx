/**
 * CapabilityApprovalDialog - Dialog for approving capability requests
 * 
 * Implements Octra's capability-based authorization model.
 */

import React from 'react';
import { Shield, Check, X, AlertTriangle, Lock, Eye, Edit, Cpu } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Capability scope type (matches SDK)
type CapabilityScope = 'read' | 'write' | 'compute';

// Capability request from dApp (matches SDK CapabilityRequest)
interface CapabilityRequest {
  circle: string;
  methods: string[];
  scope: CapabilityScope;
  encrypted: boolean;
  ttlSeconds?: number; // Optional - defaults to 24h if not specified
  appOrigin: string;
  appName?: string;
  appIcon?: string;
}

interface CapabilityApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: CapabilityRequest | null;
  onApprove: () => void;
  onDeny: () => void;
}

const scopeConfig: Record<CapabilityScope, { icon: React.ReactNode; color: string; risk: string }> = {
  read: {
    icon: <Eye className="h-4 w-4" />,
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    risk: 'low'
  },
  write: {
    icon: <Edit className="h-4 w-4" />,
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    risk: 'medium'
  },
  compute: {
    icon: <Cpu className="h-4 w-4" />,
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    risk: 'high'
  }
};

export function CapabilityApprovalDialog({
  open,
  onOpenChange,
  request,
  onApprove,
  onDeny,
}: CapabilityApprovalDialogProps) {
  if (!request) return null;

  const config = scopeConfig[request.scope];
  const isHighRisk = request.scope === 'write' || request.scope === 'compute';

  const handleApprove = () => {
    onApprove();
    onOpenChange(false);
  };

  const handleDeny = () => {
    onDeny();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Capability Request
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{request.appName || 'Unknown App'}</span> is requesting
            capability access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* App Info */}
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Avatar className="h-10 w-10">
              {request.appIcon && <AvatarImage src={request.appIcon} />}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {(request.appName || 'A').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{request.appName || 'Unknown App'}</div>
              <div className="text-sm text-muted-foreground truncate">{request.appOrigin}</div>
            </div>
          </div>

          {/* Capability Details */}
          <div className="space-y-3 p-3 border rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Circle</span>
              <span className="font-mono text-sm">{request.circle}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Scope</span>
              <Badge className={config.color}>
                {config.icon}
                <span className="ml-1 capitalize">{request.scope}</span>
              </Badge>
            </div>
            {request.encrypted && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Encrypted</span>
                <Badge variant="secondary">
                  <Lock className="h-3 w-3 mr-1" />
                  Yes
                </Badge>
              </div>
            )}
            {request.ttlSeconds && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Expires</span>
                <span className="text-sm">{Math.floor(request.ttlSeconds / 60)} minutes</span>
              </div>
            )}
          </div>

          {/* Methods List */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Requested Methods:</p>
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {request.methods.map((method, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-2 bg-muted rounded"
                >
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="font-mono text-sm">{method}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Warning */}
          {isHighRisk ? (
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                This capability allows {request.scope} operations. Only approve if you trust this application.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                This capability only allows read operations and cannot modify data.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleDeny} className="flex-1">
            <X className="h-4 w-4 mr-2" />
            Deny
          </Button>
          <Button onClick={handleApprove} className="flex-1">
            <Check className="h-4 w-4 mr-2" />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
