/**
 * Job Store for tracking async blockchain operations
 * Implements reactive state management for job subscriptions
 *
 * Requirements: 2.2, 2.3
 */

import { Job, JobId, JobStatus } from '../adapters/types';

/** Handler function for job change subscriptions */
export type JobChangeHandler = (jobs: Job[]) => void;

/**
 * Interface for the Job Store
 * Tracks async jobs and notifies subscribers of changes
 */
export interface JobStore {
  /** Track a new job */
  track(jobId: JobId, action: string, payload: unknown): void;
  /** Get job by ID */
  get(jobId: JobId): Job | undefined;
  /** Get all jobs */
  getAll(): Job[];
  /** Get jobs by status */
  getByStatus(status: JobStatus): Job[];
  /** Update job status */
  updateStatus(jobId: JobId, status: JobStatus, result?: unknown, error?: string): void;
  /** Subscribe to job changes */
  subscribe(handler: JobChangeHandler): () => void;
  /** Clear completed/failed jobs */
  clearFinished(): void;
}

/**
 * Creates a new JobStore instance
 * Uses Map for O(1) job lookups and Set for subscriber management
 */
export function createJobStore(): JobStore {
  const jobs = new Map<JobId, Job>();
  const subscribers = new Set<JobChangeHandler>();

  function notifySubscribers(): void {
    const allJobs = Array.from(jobs.values());
    subscribers.forEach((handler) => {
      try {
        handler(allJobs);
      } catch (e) {
        console.error('JobStore subscriber error:', e);
      }
    });
  }

  return {
    track(jobId: JobId, action: string, payload: unknown): void {
      const now = Date.now();
      const job: Job = {
        id: jobId,
        action,
        status: 'pending',
        payload,
        createdAt: now,
        updatedAt: now,
      };
      jobs.set(jobId, job);
      notifySubscribers();
    },

    get(jobId: JobId): Job | undefined {
      return jobs.get(jobId);
    },

    getAll(): Job[] {
      return Array.from(jobs.values());
    },

    getByStatus(status: JobStatus): Job[] {
      return Array.from(jobs.values()).filter((job) => job.status === status);
    },

    updateStatus(jobId: JobId, status: JobStatus, result?: unknown, error?: string): void {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }
      const updatedJob: Job = {
        ...job,
        status,
        result: result !== undefined ? result : job.result,
        error: error !== undefined ? error : job.error,
        updatedAt: Date.now(),
      };
      jobs.set(jobId, updatedJob);
      notifySubscribers();
    },

    subscribe(handler: JobChangeHandler): () => void {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },

    clearFinished(): void {
      const toRemove: JobId[] = [];
      jobs.forEach((job, id) => {
        if (job.status === 'completed' || job.status === 'failed') {
          toRemove.push(id);
        }
      });
      toRemove.forEach((id) => jobs.delete(id));
      if (toRemove.length > 0) {
        notifySubscribers();
      }
    },
  };
}

/** Singleton job store instance */
let globalJobStore: JobStore | null = null;

/** Get the global job store instance (creates one if needed) */
export function getJobStore(): JobStore {
  if (!globalJobStore) {
    globalJobStore = createJobStore();
  }
  return globalJobStore;
}

/** Reset the global job store (useful for testing) */
export function resetJobStore(): void {
  globalJobStore = null;
}
