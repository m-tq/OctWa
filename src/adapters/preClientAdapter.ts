// Adapter wrapping the legacy Octra pre-client API in the OctraClientAdapter interface.

import {
  OctraClientAdapter,
  ClientEvent,
  ClientEventHandler,
  JobId,
} from './types';
import { getEventBus } from '../events/eventBus';
import { getJobStore } from '../stores/jobStore';
import * as api from '../utils/api';

function generateJobId(): JobId {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export class PreClientAdapter implements OctraClientAdapter {
  private connected = false;
  private readonly eventHandlers = new Set<ClientEventHandler>();

  async connect(): Promise<void> {
    this.connected = true;
    this.emitEvent({ type: 'connection_changed', data: { connected: true }, timestamp: Date.now() });
  }

  async execute(action: string, payload: unknown): Promise<JobId> {
    const jobId = generateJobId();
    const jobStore = getJobStore();

    jobStore.track(jobId, action, payload);
    this.emitEvent({ type: 'job_started', jobId, data: { action, payload }, timestamp: Date.now() });
    this.executeAction(jobId, action, payload);

    return jobId;
  }

  onEvent(handler: ClientEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitEvent({ type: 'connection_changed', data: { connected: false }, timestamp: Date.now() });
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emitEvent(event: ClientEvent): void {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    });

    getEventBus().emit(event.type, event);
  }

  private async executeAction(jobId: JobId, action: string, payload: unknown): Promise<void> {
    const jobStore = getJobStore();

    try {
      const result = await this.dispatchAction(action, payload);
      jobStore.updateStatus(jobId, 'completed', result);
      this.emitEvent({ type: 'job_completed', jobId, data: result, timestamp: Date.now() });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      jobStore.updateStatus(jobId, 'failed', undefined, errorMessage);
      this.emitEvent({ type: 'job_failed', jobId, error: errorMessage, timestamp: Date.now() });
    }
  }

  private async dispatchAction(action: string, payload: unknown): Promise<unknown> {
    switch (action) {
      case 'send_tx':               return this.executeSendTransaction(payload);
      case 'get_balance':           return this.executeGetBalance(payload);
      case 'get_encrypted_balance': return this.executeGetEncryptedBalance(payload);
      case 'encrypt_balance':       return this.executeEncryptBalance(payload);
      case 'decrypt_balance':       return this.executeDecryptBalance(payload);
      case 'private_transfer':      return this.executePrivateTransfer(payload);
      case 'claim_private_transfer':return this.executeClaimPrivateTransfer(payload);
      case 'get_transaction_history':return this.executeGetTransactionHistory(payload);
      case 'get_address_info':      return this.executeGetAddressInfo(payload);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

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
    const p = payload as { address: string; amount: number; privateKey: string; currentCipher?: string };
    
    // Fetch encrypted balance to get current cipher if not provided
    let cipher = p.currentCipher;
    if (!cipher) {
      const encData = await api.fetchEncryptedBalance(p.address, p.privateKey);
      if (!encData || !encData.cipher) {
        throw new Error('Cannot get encrypted balance cipher');
      }
      cipher = encData.cipher;
    }
    
    return api.decryptBalance(p.address, p.amount, p.privateKey, cipher);
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
