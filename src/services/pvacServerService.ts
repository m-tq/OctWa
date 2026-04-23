/**
 * PVAC (Publicly Verifiable Arithmetic Computations) Server Service
 * 
 * Handles communication with local PVAC server for heavy cryptographic operations.
 * 
 * Features:
 * - Multiple server management
 * - Auth token validation
 * - Job ID tracking
 * - Request timeout (30s)
 * - Retry logic with exponential backoff
 * - Minimal logging
 */

import { logger } from '@/utils/logger';
import { getActiveRPCProvider } from '@/utils/rpc';

function hexToBase64(hex: string): string {
  const cleanHex = hex.replace(/^0x/i, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return Buffer.from(bytes).toString('base64');
}

export interface PvacServer {
  id: string;
  name: string;
  url: string;
  authToken: string;
  createdAt: number;
  lastUsed?: number;
}

export interface PvacServerConfig {
  servers: PvacServer[];
  activeServerId: string | null;
}

export interface DecryptBalanceRequest {
  cipher: string;
  private_key: string;
}

export interface DecryptBalanceResponse {
  success: boolean;
  balance?: number;
  balance_oct?: string;
  error?: string;
}

export interface EncryptBalanceRequest {
  amount: number;
  private_key: string;
  public_key: string;
  address: string;
  nonce: number;
  ou?: string;
}

export interface DecryptToPublicRequest {
  amount: number;
  private_key: string;
  public_key: string;
  current_cipher: string;
  address: string;
  nonce: number;
  ou?: string;
}

export interface StealthSendRequest {
  to_address: string;
  amount: number;
  current_cipher: string;
  recipient_view_pubkey: string;
  from_address: string;
  nonce: number;
  private_key: string;
  public_key: string;
  ou?: string;
}

export interface ClaimStealthRequest {
  stealth_output: any;
  private_key: string;
  public_key: string;
  address: string;
  nonce: number;
  ou?: string;
}

export interface ScanStealthRequest {
  private_key: string;
  stealth_outputs: any[];
}

export interface PvacServerResponse {
  success: boolean;
  tx?: any;
  transfers?: any[];
  error?: string;
  job_id?: string;
}

export interface GetPvacPubkeyRequest {
  private_key: string;
  public_key: string;
  address: string;
}

export interface GetPvacPubkeyResponse {
  success: boolean;
  pvac_pubkey?: string;
  aes_kat?: string;
  reg_sig?: string;
  error?: string;
  job_id?: string;
}

export interface EnsurePvacRegisteredRequest {
  private_key: string;
  public_key: string;
  address: string;
  rpc_url: string;
}

export interface EnsurePvacRegisteredResponse {
  success: boolean;
  registered?: boolean;
  pvac_pubkey?: string;
  error?: string;
  job_id?: string;
}

class PvacServerService {
  private config: PvacServerConfig = { servers: [], activeServerId: null };
  private readonly CONFIG_KEY = 'pvacServerConfig';
  private readonly REQUEST_TIMEOUT = 600000; // 10 minutes — PVAC crypto ops are heavy
  private readonly MAX_RETRIES = 2;

  constructor() {
    this.loadConfig();
  }

  private generateServerId(): string {
    return `srv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private loadConfig(): void {
    try {
      const stored = localStorage.getItem(this.CONFIG_KEY);
      if (stored) {
        this.config = JSON.parse(stored);
      }
    } catch (error) {
      logger.error('Failed to load PVAC config', error);
    }
  }

  private saveConfig(): void {
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify(this.config));
  }

  // Server Management
  getAllServers(): PvacServer[] {
    return this.config.servers;
  }

  getActiveServerId(): string | null {
    return this.config.activeServerId;
  }

  getActiveServer(): PvacServer | null {
    if (!this.config.activeServerId) return null;
    return this.config.servers.find(s => s.id === this.config.activeServerId) || null;
  }

  addServer(data: { name: string; url: string; authToken: string }): PvacServer {
    const server: PvacServer = {
      id: this.generateServerId(),
      name: data.name,
      url: data.url,
      authToken: data.authToken,
      createdAt: Date.now()
    };
    
    this.config.servers.push(server);
    
    // Set as active if it's the first server
    if (this.config.servers.length === 1) {
      this.config.activeServerId = server.id;
    }
    
    this.saveConfig();
    return server;
  }

  updateServer(id: string, data: { name?: string; url?: string; authToken?: string }): void {
    const server = this.config.servers.find(s => s.id === id);
    if (!server) throw new Error('Server not found');
    
    if (data.name) server.name = data.name;
    if (data.url) server.url = data.url;
    if (data.authToken) server.authToken = data.authToken;
    
    this.saveConfig();
  }

  deleteServer(id: string): void {
    this.config.servers = this.config.servers.filter(s => s.id !== id);
    
    // Clear active if deleted
    if (this.config.activeServerId === id) {
      this.config.activeServerId = this.config.servers.length > 0 ? this.config.servers[0].id : null;
    }
    
    this.saveConfig();
  }

  setActiveServer(id: string): void {
    const server = this.config.servers.find(s => s.id === id);
    if (!server) throw new Error('Server not found');
    
    this.config.activeServerId = id;
    server.lastUsed = Date.now();
    this.saveConfig();
  }

  isEnabled(): boolean {
    const server = this.getActiveServer();
    return !!server && !!server.authToken;
  }

  async checkAvailability(): Promise<boolean> {
    const server = this.getActiveServer();
    if (!server) return false;

    try {
      const response = await fetch(`${server.url}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async testConnection(url?: string, authToken?: string): Promise<{ success: boolean; message: string; version?: string }> {
    const testUrl = url || this.getActiveServer()?.url;
    const testToken = authToken || this.getActiveServer()?.authToken;
    
    if (!testUrl || !testToken) {
      return {
        success: false,
        message: 'Server URL and auth token are required'
      };
    }

    try {
      const response = await fetch(`${testUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            message: 'Invalid auth token. Please check your token.'
          };
        }
        return {
          success: false,
          message: `Server error: ${response.status}`
        };
      }

      const data = await response.json();
      return {
        success: true,
        message: 'Connection successful',
        version: data.version || '1.0.0'
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          message: 'Connection timeout. Please check if server is running.'
        };
      }
      return {
        success: false,
        message: 'Cannot connect to server. Please check URL and ensure server is running.'
      };
    }
  }

  private async request<T>(endpoint: string, data?: any, operation?: string, retryCount = 0): Promise<T> {
    const server = this.getActiveServer();
    if (!server) {
      throw new Error('No PVAC server configured');
    }

    const url = `${server.url}${endpoint}`;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

      try {
        const response = await fetch(url, {
          method: data ? 'POST' : 'GET',
          headers: {
            'Authorization': `Bearer ${server.authToken}`,
            'Content-Type': 'application/json'
          },
          body: data ? JSON.stringify(data) : undefined,
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Invalid auth token. Please check PVAC server settings.');
          }
          const errorText = await response.text();
          throw new Error(`PVAC server error (${response.status}): ${errorText}`);
        }

        const result = await response.json();
        const duration = Date.now() - startTime;
        
        if (operation && result.job_id) {
          logger.pvacSuccess(operation, result.job_id, 'Complete', duration);
        }
        
        return result;
        
      } catch (error: any) {
        clearTimeout(timeout);
        
        if (error.name === 'AbortError') {
          throw new Error(`PVAC request timeout after ${this.REQUEST_TIMEOUT}ms`);
        }
        
        throw error;
      }
      
    } catch (error: any) {
      // Retry logic
      if (retryCount < this.MAX_RETRIES) {
        if (error.message.includes('401') || error.message.includes('timeout')) {
          throw error;
        }
        
        const backoffMs = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.request<T>(endpoint, data, operation, retryCount + 1);
      }
      
      if (error.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to PVAC server. Please ensure the server is running.');
      }
      
      throw error;
    }
  }

  async checkHealth(): Promise<{ status: string; version: string }> {
    return this.request('/health', undefined, 'health');
  }

  async decryptBalance(cipher: string, privateKey: string): Promise<DecryptBalanceResponse> {
    return this.request<DecryptBalanceResponse>('/api/decrypt_balance', {
      cipher,
      private_key: privateKey
    }, 'decrypt_balance');
  }

  async encryptBalance(request: EncryptBalanceRequest): Promise<PvacServerResponse> {
    let publicKeyBase64 = request.public_key;
    if (request.public_key && /^[0-9a-fA-F]+$/.test(request.public_key.replace(/^0x/i, ''))) {
      publicKeyBase64 = hexToBase64(request.public_key);
    }
    const rpcUrl = getActiveRPCProvider()?.url || '';
    return this.request<PvacServerResponse>('/api/encrypt_balance', {
      ...request,
      public_key: publicKeyBase64,
      ou: request.ou || '10000',
      rpc_url: rpcUrl,
    }, 'encrypt');
  }

  async decryptToPublic(request: DecryptToPublicRequest): Promise<PvacServerResponse> {
    let publicKeyBase64 = request.public_key;
    if (request.public_key && /^[0-9a-fA-F]+$/.test(request.public_key.replace(/^0x/i, ''))) {
      publicKeyBase64 = hexToBase64(request.public_key);
    }
    const rpcUrl = getActiveRPCProvider()?.url || '';
    return this.request<PvacServerResponse>('/api/decrypt_to_public', {
      ...request,
      public_key: publicKeyBase64,
      ou: request.ou || '10000',
      rpc_url: rpcUrl,
    }, 'decrypt');
  }

  async stealthSend(request: StealthSendRequest): Promise<PvacServerResponse> {
    let publicKeyBase64 = request.public_key;
    if (request.public_key && /^[0-9a-fA-F]+$/.test(request.public_key.replace(/^0x/i, ''))) {
      publicKeyBase64 = hexToBase64(request.public_key);
    }
    const rpcUrl = getActiveRPCProvider()?.url || '';
    return this.request<PvacServerResponse>('/api/stealth_send', {
      ...request,
      public_key: publicKeyBase64,
      ou: request.ou || '5000',
      rpc_url: rpcUrl,
    }, 'stealth_send');
  }

  async claimStealth(request: ClaimStealthRequest): Promise<PvacServerResponse> {
    let publicKeyBase64 = request.public_key;
    if (request.public_key && /^[0-9a-fA-F]+$/.test(request.public_key.replace(/^0x/i, ''))) {
      publicKeyBase64 = hexToBase64(request.public_key);
    }
    
    return this.request<PvacServerResponse>('/api/claim_stealth', {
      ...request,
      public_key: publicKeyBase64
    }, 'claim');
  }

  async scanStealth(request: ScanStealthRequest): Promise<PvacServerResponse> {
    return this.request<PvacServerResponse>('/api/scan_stealth', request, 'scan');
  }

  async getPvacPubkey(request: GetPvacPubkeyRequest): Promise<GetPvacPubkeyResponse> {
    let publicKeyBase64 = request.public_key;
    if (request.public_key && /^[0-9a-fA-F]+$/.test(request.public_key.replace(/^0x/i, ''))) {
      publicKeyBase64 = hexToBase64(request.public_key);
    }
    return this.request<GetPvacPubkeyResponse>('/api/get_pvac_pubkey', {
      ...request,
      public_key: publicKeyBase64,
    }, 'get_pvac_pubkey');
  }

  async ensurePvacRegistered(request: EnsurePvacRegisteredRequest): Promise<EnsurePvacRegisteredResponse> {
    let publicKeyBase64 = request.public_key;
    if (request.public_key && /^[0-9a-fA-F]+$/.test(request.public_key.replace(/^0x/i, ''))) {
      publicKeyBase64 = hexToBase64(request.public_key);
    }
    return this.request<EnsurePvacRegisteredResponse>('/api/ensure_pvac_registered', {
      ...request,
      public_key: publicKeyBase64,
    }, 'ensure_pvac_registered');
  }
}

export const pvacServerService = new PvacServerService();
