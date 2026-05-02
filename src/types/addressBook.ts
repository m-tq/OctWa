// Address Book Types — local, offline, private, user-controlled.

export type ContactTag =
  | 'public'
  | 'private'
  | 'encrypted'
  | 'service'
  | 'circle'
  | 'exchange'
  | 'personal';

export interface Contact {
  id: string;
  address: string;
  label: string;
  tags: ContactTag[];
  note?: string;
  /** Auto-select mode when sending to this contact. */
  preferredMode?: 'public' | 'private';
  createdAt: number;
  updatedAt: number;
}

export interface WalletLabel {
  address: string;
  name: string;
  /** @deprecated Kept for backward compatibility — not actively used. */
  emoji?: string;
  updatedAt: number;
}

export interface AddressBookData {
  version: number;
  contacts: Contact[];
  walletLabels: WalletLabel[];
  lastUpdated: number;
}

export const DEFAULT_ADDRESS_BOOK: AddressBookData = {
  version: 1,
  contacts: [],
  walletLabels: [],
  lastUpdated: Date.now(),
};

export const CONTACT_TAGS: {
  value: ContactTag;
  label: string;
  color: string;
  icon: string;
}[] = [
  { value: 'public',    label: 'Public',    color: 'bg-green-500/20 text-green-600',    icon: '🌐' },
  { value: 'private',   label: 'Private',   color: 'bg-[#3B567F]/20 text-[#3B567F]',   icon: '🔒' },
  { value: 'encrypted', label: 'Encrypted', color: 'bg-purple-500/20 text-purple-600',  icon: '🔐' },
  { value: 'service',   label: 'Service',   color: 'bg-orange-500/20 text-orange-600',  icon: '⚙️' },
  { value: 'circle',    label: 'Circle',    color: 'bg-blue-500/20 text-blue-600',      icon: '👥' },
  { value: 'exchange',  label: 'Exchange',  color: 'bg-yellow-500/20 text-yellow-600',  icon: '💱' },
  { value: 'personal',  label: 'Personal',  color: 'bg-pink-500/20 text-pink-600',      icon: '👤' },
];
