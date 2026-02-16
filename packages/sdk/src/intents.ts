/**
 * Octra Intents SDK
 * Client-side helpers for intent-based swaps
 * 
 * NOTE: Intent-based swaps feature is currently disabled/commented out
 * This feature is under development and not yet ready for production use
 */

/*
import { OctraSDK } from './sdk.js';
import type { Capability, InvocationResult } from './types.js';

// =============================================================================
// Types
// =============================================================================

export type TargetChain = 'ethereum_sepolia';

export interface SwapIntentPayload {
  version: 1;
  intentType: 'swap';
  fromAsset: 'OCT';
  toAsset: 'ETH';
  amountIn: number;
  minAmountOut: number;
  targetChain: TargetChain;
  targetAddress: string;
  expiry: number;
  nonce: string;
}

export interface Quote {
  from: 'OCT';
  to: 'ETH';
  amountIn: number;
  estimatedOut: number;
  rate: number;
  feeBps: number;
  expiresIn: number;
  escrowAddress: string;
  network: TargetChain;
}

export interface SwapResult {
  success: boolean;
  intentId?: string;
  octraTxHash?: string;
  error?: string;
}

export interface IntentStatus {
  intentId: string;
  status: 'OPEN' | 'FULFILLED' | 'EXPIRED' | 'REJECTED';
  ethTxHash?: string;
  amountOut?: number;
}

// =============================================================================
// Intents Client
// =============================================================================

export class IntentsClient {
  private apiUrl: string;
  private sdk: OctraSDK;
  private capability: Capability | null = null;

  constructor(sdk: OctraSDK, apiUrl: string) {
    this.sdk = sdk;
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  setCapability(capability: Capability): void {
    this.capability = capability;
  }

  async getQuote(amountIn: number): Promise<Quote> {
    const response = await fetch(
      `${this.apiUrl}/quote?from=OCT&to=ETH&amount=${amountIn}`
    );
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Quote failed: ${response.status}`);
    }
    
    return response.json();
  }

  async createIntent(
    quote: Quote,
    targetAddress: string,
    slippageBps: number = 50
  ): Promise<SwapIntentPayload> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      throw new Error('Invalid Ethereum address');
    }

    const slippageMultiplier = 1 - slippageBps / 10000;
    const minAmountOut = quote.estimatedOut * slippageMultiplier;

    const payload: SwapIntentPayload = {
      version: 1,
      intentType: 'swap',
      fromAsset: 'OCT',
      toAsset: 'ETH',
      amountIn: quote.amountIn,
      minAmountOut,
      targetChain: 'ethereum_sepolia',
      targetAddress,
      expiry: Date.now() + 5 * 60 * 1000,
      nonce: crypto.randomUUID(),
    };

    return payload;
  }

  async signIntent(payload: SwapIntentPayload): Promise<InvocationResult> {
    if (!this.capability) {
      throw new Error('No capability set - call setCapability first');
    }

    return this.sdk.invoke({
      capabilityId: this.capability.id,
      method: 'sign_intent',
      payload: new TextEncoder().encode(JSON.stringify(payload)),
    });
  }

  async submitIntent(octraTxHash: string): Promise<{
    intentId: string;
    status: string;
    message: string;
  }> {
    const response = await fetch(`${this.apiUrl}/swap/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ octraTxHash }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || `Submit failed: ${response.status}`);
    }

    return response.json();
  }

  async getIntentStatus(intentId: string): Promise<IntentStatus> {
    const response = await fetch(`${this.apiUrl}/swap/${intentId}`);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Status check failed: ${response.status}`);
    }
    
    return response.json();
  }

  async waitForFulfillment(
    intentId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<IntentStatus> {
    const { timeoutMs = 5 * 60 * 1000, pollIntervalMs = 3000 } = options;
    const startTime = Date.now();
    let lastError: Error | null = null;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getIntentStatus(intentId);
        consecutiveErrors = 0;
        
        if (status.status === 'FULFILLED' || status.status === 'EXPIRED' || status.status === 'REJECTED') {
          return status;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        consecutiveErrors++;
        console.warn(`[IntentsClient] Status check failed (${consecutiveErrors}/${maxConsecutiveErrors}):`, lastError.message);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Failed to get intent status after ${maxConsecutiveErrors} attempts: ${lastError.message}`);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timeout waiting for fulfillment${lastError ? `: last error was ${lastError.message}` : ''}`);
  }
}

export function deriveEvmAddress(octraPubKey: string): string {
  if (!octraPubKey) {
    throw new Error('Octra public key is required');
  }
  throw new Error('deriveEvmAddress is deprecated. Use connection.evmAddress from wallet instead.');
}
*/
