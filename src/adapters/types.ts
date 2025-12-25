/**
 * Adapter types for client-agnostic blockchain interactions
 * Supports both legacy pre-client and upcoming new client
 */

/** Unique identifier for tracking async jobs */
export type JobId = string;

/** Status of an async job */
export type JobStatus = 'pending' | 'completed' | 'failed';

/** Represents an async job being tracked */
export interface Job {
  /** Unique job identifier */
  id: JobId;
  /** Action type (e.g., 'send_tx', 'call_contract', 'get_balance') */
  action: string;
  /** Current job status */
  status: JobStatus;
  /** Original request payload */
  payload: unknown;
  /** Result data (may be encrypted) */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Unix timestamp when job was created */
  createdAt: number;
  /** Unix timestamp when job was last updated */
  updatedAt: number;
}

/** Types of events emitted by client adapters */
export type ClientEventType =
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'encrypted_result_ready'
  | 'connection_changed';

/** Event emitted by client adapters */
export interface ClientEvent {
  /** Type of event */
  type: ClientEventType;
  /** Associated job ID (if applicable) */
  jobId?: JobId;
  /** Event data payload */
  data?: unknown;
  /** Error message (for failure events) */
  error?: string;
  /** Unix timestamp when event occurred */
  timestamp: number;
}

/** Handler function for client events */
export type ClientEventHandler = (event: ClientEvent) => void;

/**
 * Core interface for Octra client adapters
 * All client implementations must implement this interface
 */
export interface OctraClientAdapter {
  /** Connect to the client */
  connect(): Promise<void>;

  /**
   * Execute an action and return a job ID for tracking
   * @param action - The action to execute (e.g., 'send_tx', 'get_balance')
   * @param payload - Action-specific payload
   * @returns Job ID for tracking the async operation
   */
  execute(action: string, payload: unknown): Promise<JobId>;

  /**
   * Subscribe to client events
   * @param handler - Function to call when events occur
   * @returns Unsubscribe function
   */
  onEvent(handler: ClientEventHandler): () => void;

  /** Disconnect from the client */
  disconnect(): Promise<void>;

  /** Check if currently connected */
  isConnected(): boolean;
}

/** Client type identifier */
export type ClientType = 'pre-client' | 'next-client';

/** Configuration for adapter factory */
export interface AdapterFactoryConfig {
  /** Which client type to use */
  clientType: ClientType;
  /** RPC URL for the client */
  rpcUrl?: string;
}

/** Error thrown when a feature is not yet implemented */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`Method '${method}' is not implemented for this adapter`);
    this.name = 'NotImplementedError';
  }
}

/** Error thrown when a required capability is missing */
export class CapabilityRequiredError extends Error {
  constructor(public readonly capability: string) {
    super(`Required capability '${capability}' is not granted`);
    this.name = 'CapabilityRequiredError';
  }
}
