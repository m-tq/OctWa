import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Globe, Shield } from 'lucide-react';
import { OperationMode } from '../utils/modeStorage';

interface ModeIndicatorProps {
  mode: OperationMode;
  className?: string;
}

export function ModeIndicator({ mode, className = '' }: ModeIndicatorProps) {
  if (mode === 'private') {
    return (
      <Badge 
        className={`bg-[#0000db] text-white hover:bg-[#0000db]/90 flex items-center gap-1.5 ${className}`}
      >
        <Shield className="h-3 w-3" />
        <span className="text-xs font-medium">Private Mode</span>
      </Badge>
    );
  }

  return (
    <Badge 
      variant="secondary"
      className={`flex items-center gap-1.5 ${className}`}
    >
      <Globe className="h-3 w-3" />
      <span className="text-xs font-medium">Public Mode</span>
    </Badge>
  );
}
