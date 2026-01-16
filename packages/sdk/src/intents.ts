/**
 * Octra Intents SDK
 * Client-side helpers for intent-based swaps
 */

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

  /**
   * Get quote from backend API
   */
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

  /**
   * Create and sign swap intent
   * Returns the signed intent ready for submission
   */
  async createIntent(
    quote: Quote,
    targetAddress: string,
    slippageBps: number = 50
  ): Promise<SwapIntentPayload> {
    // Validate target address
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      throw new Error('Invalid Ethereum address');
    }

    // Calculate min amount with slippage
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
      expiry: Date.now() + 5 * 60 * 1000, // 5 minutes
      nonce: crypto.randomUUID(),
    };

    return payload;
  }

  /**
   * Sign intent via wallet
   */
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

  /**
   * Submit intent to backend after OCT transaction is sent
   */
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

  /**
   * Poll intent status
   */
  async getIntentStatus(intentId: string): Promise<IntentStatus> {
    const response = await fetch(`${this.apiUrl}/swap/${intentId}`);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Status check failed: ${response.status}`);
    }
    
    return response.json();
  }

  /**
   * Poll until intent is fulfilled or expired
   */
  async waitForFulfillment(
    intentId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<IntentStatus> {
    const { timeoutMs = 5 * 60 * 1000, pollIntervalMs = 3000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getIntentStatus(intentId);
      
      if (status.status === 'FULFILLED' || status.status === 'EXPIRED' || status.status === 'REJECTED') {
        return status;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Timeout waiting for fulfillment');
  }
}

/**
 * @deprecated EVM address is now derived by the wallet and returned in Connection.evmAddress
 * This function is kept for backward compatibility but should not be used.
 */
export function deriveEvmAddress(_octraPubKey: string): string {
  console.warn('deriveEvmAddress is deprecated. Use connection.evmAddress from wallet instead.');
  return '';
}
