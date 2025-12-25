/**
 * PreClientAdapter - Adapter for the legacy Octra pre-client
 * Wraps existing API calls in the OctraClientAdapter interface
 * 
 * Requirements: 1.3, 2.1, 3.2
 */

import {
  OctraClientAdapter,
  ClientEvent,
  ClientEventHandler,
  JobId,
} from './types';
import { getEventBus } from '../events/eventBus';
import { getJobStore } from '../stores/jobStore';
import * as api from '../utils/api';

/**
 * Generate a unique job ID
 */
function generateJobId(): JobId {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * PreClientAdapter wraps the existing pre-client API calls
 * and provides async job-based execution with event emission
 */
export class PreClientAdapter implements OctraClientAdapter {
  private connected = false;
  private eventHandlers = new Set<ClientEventHandler>();

  /**
   * Connect to the pre-client
   * For pre-client, this just marks us as connected since RPC is stateless
   */
  async connect(): Promise<void> {
    this.connected = true;
    this.emitEvent({
      type: 'connection_changed',
      data: { connected: true },
      timestamp: Date.now(),
    });
  }

  /**
   * Execute an action and return a job ID for tracking
   * The actual operation runs asynchronously
   */
  async execute(action: string, payload: unknown): Promise<JobId> {
    const jobId = generateJobId();
    const jobStore = getJobStore();

    // Track the job immediately
    jobStore.track(jobId, action, payload);

    // Emit job_started event
    this.emitEvent({
      type: 'job_started',
      jobId,
      data: { action, payload },
      timestamp: Date.now(),
    });

    // Execute the action asynchronously
    this.executeAction(jobId, action, payload);

    // Return jobId immediately without waiting
    return jobId;
  }

  /**
   * Subscribe to client events
   */
  onEvent(handler: ClientEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /**
   * Disconnect from the pre-client
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent({
      type: 'connection_changed',
      data: { connected: false },
      timestamp: Date.now(),
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Emit an event to all handlers and the global event bus
   */
  private emitEvent(event: ClientEvent): void {
    // Emit to local handlers
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    });

    // Emit to global event bus
    const eventBus = getEventBus();
    eventBus.emit(event.type, event);
  }

  /**
   * Execute the actual action and update job status
   */
  private async executeAction(
    jobId: JobId,
    action: string,
    payload: unknown
  ): Promise<void> {
    const jobStore = getJobStore();

    try {
      let result: unknown;

      switch (action) {
        case 'send_tx':
          result = await this.executeSendTransaction(payload);
          break;
        case 'get_balance':
          result = await this.executeGetBalance(payload);
          break;
        case 'get_encrypted_balance':
          result = await this.executeGetEncryptedBalance(payload);
          break;
        case 'encrypt_balance':
          result = await this.executeEncryptBalance(payload);
          break;
        case 'decrypt_balance':
          result = await this.executeDecryptBalance(payload);
          break;
        case 'private_transfer':
          result = await this.executePrivateTransfer(payload);
          break;
        case 'claim_private_transfer':
          result = await this.executeClaimPrivateTransfer(payload);
          break;
        case 'get_transaction_history':
          result = await this.executeGetTransactionHistory(payload);
          break;
        case 'get_address_info':
          result = await this.executeGetAddressInfo(payload);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Update job as completed
      jobStore.updateStatus(jobId, 'completed', result);

      // Emit job_completed event
      this.emitEvent({
        type: 'job_completed',
        jobId,
        data: result,
        timestamp: Date.now(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update job as failed
      jobStore.updateStatus(jobId, 'failed', undefined, errorMessage);

      // Emit job_failed event
      this.emitEvent({
        type: 'job_failed',
        jobId,
        error: errorMessage,
        timestamp: Date.now(),
      });
    }
  }

  // Action executors that wrap existing API calls

  private async executeSendTransaction(payload: unknown): Promise<unknown> {
    const p = payload as {
      from: string;
      to: string;
      amount: number;
      nonce: number;
      privateKey: string;
      publicKey: string;
      message?: string;
      customOu?: number;
    };
    const tx = api.createTransaction(
      p.from,
      p.to,
      p.amount,
      p.nonce,
      p.privateKey,
      p.publicKey,
      p.message,
      p.customOu
    );
    return api.sendTransaction(tx);
  }

  private async executeGetBalance(payload: unknown): Promise<unknown> {
    const p = payload as { address: string };
    return api.fetchBalance(p.address);
  }

  private async executeGetEncryptedBalance(payload: unknown): Promise<unknown> {
    const p = payload as { address: string; privateKey: string };
    return api.fetchEncryptedBalance(p.address, p.privateKey);
  }

  private async executeEncryptBalance(payload: unknown): Promise<unknown> {
    const p = payload as { address: string; amount: number; privateKey: string };
    return api.encryptBalance(p.address, p.amount, p.privateKey);
  }

  private async executeDecryptBalance(payload: unknown): Promise<unknown> {
    const p = payload as { address: string; amount: number; privateKey: string };
    return api.decryptBalance(p.address, p.amount, p.privateKey);
  }

  private async executePrivateTransfer(payload: unknown): Promise<unknown> {
    const p = payload as {
      fromAddress: string;
      toAddress: string;
      amount: number;
      fromPrivateKey: string;
    };
    return api.createPrivateTransfer(p.fromAddress, p.toAddress, p.amount, p.fromPrivateKey);
  }

  private async executeClaimPrivateTransfer(payload: unknown): Promise<unknown> {
    const p = payload as {
      recipientAddress: string;
      privateKey: string;
      transferId: string;
    };
    return api.claimPrivateTransfer(p.recipientAddress, p.privateKey, p.transferId);
  }

  private async executeGetTransactionHistory(payload: unknown): Promise<unknown> {
    const p = payload as { address: string; limit?: number; offset?: number };
    return api.fetchTransactionHistory(p.address, { limit: p.limit, offset: p.offset });
  }

  private async executeGetAddressInfo(payload: unknown): Promise<unknown> {
    const p = payload as { address: string };
    return api.getAddressInfo(p.address);
  }
}
