/**
 * JobStatusIndicator - Shows pending/completed/failed states for jobs
 * 
 * Requirements: 2.4
 */

import React from 'react';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { JobStatus } from '../adapters/types';

interface JobStatusIndicatorProps {
  /** Current job status */
  status: JobStatus;
  /** Show as badge or inline */
  variant?: 'badge' | 'inline' | 'icon';
  /** Size of the indicator */
  size?: 'sm' | 'md' | 'lg';
  /** Custom class name */
  className?: string;
}

const statusConfig = {
  pending: {
    icon: Loader2,
    label: 'Pending',
    badgeVariant: 'secondary' as const,
    color: 'text-amber-500',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    badgeVariant: 'default' as const,
    color: 'text-green-500',
    animate: false,
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    badgeVariant: 'destructive' as const,
    color: 'text-red-500',
    animate: false,
  },
};

const sizeConfig = {
  sm: { icon: 'h-3 w-3', text: 'text-xs' },
  md: { icon: 'h-4 w-4', text: 'text-sm' },
  lg: { icon: 'h-5 w-5', text: 'text-base' },
};

export function JobStatusIndicator({
  status,
  variant = 'badge',
  size = 'md',
  className = '',
}: JobStatusIndicatorProps) {
  const config = statusConfig[status];
  const sizes = sizeConfig[size];
  const Icon = config.icon;

  if (variant === 'icon') {
    return (
      <Icon
        className={`${sizes.icon} ${config.color} ${config.animate ? 'animate-spin' : ''} ${className}`}
      />
    );
  }

  if (variant === 'inline') {
    return (
      <span className={`flex items-center gap-1.5 ${sizes.text} ${className}`}>
        <Icon
          className={`${sizes.icon} ${config.color} ${config.animate ? 'animate-spin' : ''}`}
        />
        <span className={config.color}>{config.label}</span>
      </span>
    );
  }

  // Badge variant
  return (
    <Badge variant={config.badgeVariant} className={`gap-1 ${className}`}>
      <Icon
        className={`${sizes.icon} ${config.animate ? 'animate-spin' : ''}`}
      />
      {config.label}
    </Badge>
  );
}

/**
 * Simple status dot indicator
 */
export function JobStatusDot({
  status,
  size = 'md',
  className = '',
}: {
  status: JobStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dotSizes = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
  };

  const dotColors = {
    pending: 'bg-amber-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  return (
    <span
      className={`inline-block rounded-full ${dotSizes[size]} ${dotColors[status]} ${className}`}
    />
  );
}
