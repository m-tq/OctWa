import { ChainType } from '../utils/keyManager';

export interface ChainWalletData {
  octraAddress: string; // Link to the parent Octra wallet
  address: string;
  balance: string | null;
  privateKey?: string; // Hex or WIF or Base58
  publicKey?: string;
  isLoading: boolean;
  chainType: ChainType;
  name?: string;
  derivationPath?: string;
}

export { ChainType };
