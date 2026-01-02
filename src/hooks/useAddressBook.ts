import { useState, useEffect, useCallback } from 'react';
import { Contact, WalletLabel } from '../types/addressBook';
import { addressBook } from '../utils/addressBook';

export function useAddressBook() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [walletLabels, setWalletLabels] = useState<WalletLabel[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      await addressBook.init();
      setContacts(addressBook.getContacts());
      setWalletLabels(addressBook.getWalletLabels());
      setIsInitialized(true);
    };

    init();

    const unsubscribe = addressBook.subscribe(() => {
      setContacts(addressBook.getContacts());
      setWalletLabels(addressBook.getWalletLabels());
    });

    return unsubscribe;
  }, []);

  const getContactByAddress = useCallback((address: string) => {
    return addressBook.getContactByAddress(address);
  }, []);

  const getWalletLabel = useCallback((address: string) => {
    return addressBook.getWalletLabel(address);
  }, []);

  const getWalletDisplayName = useCallback((address: string) => {
    return addressBook.getWalletDisplayName(address);
  }, []);

  const autoLabelWallets = useCallback(async (wallets: { address: string; type?: string }[]) => {
    await addressBook.autoLabelWallets(wallets);
  }, []);

  return {
    contacts,
    walletLabels,
    isInitialized,
    getContactByAddress,
    getWalletLabel,
    getWalletDisplayName,
    autoLabelWallets,
    addressBook, // Expose the manager for direct access
  };
}
