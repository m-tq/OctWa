/**
 * ActivityPanel - Displays async jobs and transactions with real-time updates
 * 
 * Requirements: 6.2
 */

import React, { useState, useEffect } from 'react';
import { Activity, Trash2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Job } from '../adapters/types';
import { getJobStore } from '../stores/jobStore';
import { JobStatusIndicator } from './JobStatusIndicator';

interface ActivityPanelProps {
  /** Maximum number of jobs to display */
  maxJobs?: number;
  /** Custom class name */
  className?: string;
  /** Whether to show the clear button */
  showClearButton?: boolean;
}

export function ActivityPanel({
  maxJobs = 50,
  className = '',
  showClearButton = true,
}: ActivityPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const jobStore = getJobStore();
    
    // Initial load
    setJobs(jobStore.getAll().slice(0, maxJobs));

    // Subscribe to updates
    const unsubscribe = jobStore.subscribe((updatedJobs) => {
      setJobs(updatedJobs.slice(0, maxJobs));
    });

    return unsubscribe;
  }, [maxJobs]);

  const handleClearFinished = () => {
    const jobStore = getJobStore();
    jobStore.clearFinished();
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatAction = (action: string) => {
    return action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Activity
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCount} pending
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {showClearButton && (completedCount > 0 || failedCount > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFinished}
              className="h-8 px-2"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {formatAction(job.action)}
                      </span>
                      <JobStatusIndicator status={job.status} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatTimestamp(job.createdAt)}</span>
                      {job.status !== 'pending' && (
                        <>
                          <span>→</span>
                          <span>{formatTimestamp(job.updatedAt)}</span>
                        </>
                      )}
                    </div>
                    {job.error && (
                      <p className="text-xs text-red-500 mt-1 truncate">
                        {job.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact activity indicator for headers/toolbars
 */
export function ActivityIndicator({ className = '' }: { className?: string }) {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const jobStore = getJobStore();
    
    const updateCount = (jobs: Job[]) => {
      setPendingCount(jobs.filter((j) => j.status === 'pending').length);
    };

    updateCount(jobStore.getAll());
    const unsubscribe = jobStore.subscribe(updateCount);

    return unsubscribe;
  }, []);

  if (pendingCount === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />
      <span className="text-xs text-muted-foreground">
        {pendingCount} pending
      </span>
    </div>
  );
}
