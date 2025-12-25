/**
 * NextClientAdapter - Placeholder adapter for the upcoming Octra new client
 * All methods throw NotImplementedError until the new client is available
 * 
 * Requirements: 1.4
 */

import {
  OctraClientAdapter,
  ClientEventHandler,
  JobId,
  NotImplementedError,
} from './types';

/**
 * NextClientAdapter is a placeholder for the upcoming new Octra client
 * All methods throw NotImplementedError until implementation is ready
 */
export class NextClientAdapter implements OctraClientAdapter {
  async connect(): Promise<void> {
    throw new NotImplementedError('connect');
  }

  async execute(_action: string, _payload: unknown): Promise<JobId> {
    throw new NotImplementedError('execute');
  }

  onEvent(_handler: ClientEventHandler): () => void {
    throw new NotImplementedError('onEvent');
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError('disconnect');
  }

  isConnected(): boolean {
    throw new NotImplementedError('isConnected');
  }
}
