/**
 * ContractPanel - Placeholder for future contract interactions
 * 
 * Requirements: 6.3
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileCode2, Construction } from 'lucide-react';

interface ContractPanelProps {
  /** Custom class name */
  className?: string;
}

export function ContractPanel({ className = '' }: ContractPanelProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCode2 className="h-4 w-4" />
          Contract Interactions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Construction className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-medium mb-2">Coming Soon</h3>
          <p className="text-sm text-muted-foreground max-w-[250px]">
            Contract interaction features will be available in a future update.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
