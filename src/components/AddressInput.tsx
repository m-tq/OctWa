import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookUser, Search, X } from 'lucide-react';
import { CONTACT_TAGS } from '../types/addressBook';
import { useAddressBook } from '../hooks/useAddressBook';

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  isPopupMode?: boolean;
  isCompact?: boolean;
  id?: string;
}

export function AddressInput({
  value,
  onChange,
  placeholder = 'oct...',
  disabled = false,
  className = '',
  isPopupMode = false,
  isCompact = false,
  id,
}: AddressInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const { contacts, walletLabels } = useAddressBook();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate dropdown position when opening
  useEffect(() => {
    if (showDropdown && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = isPopupMode ? 180 : 240; // Approximate dropdown height
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // If not enough space below but enough above, open upward
      if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
        setDropdownPosition('top');
      } else {
        setDropdownPosition('bottom');
      }
    }
  }, [showDropdown, isPopupMode]);

  // Filter contacts and wallets based on search
  const filteredContacts = searchQuery
    ? contacts.filter(
        (c) =>
          c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.address.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : contacts;

  const filteredWallets = searchQuery
    ? walletLabels.filter(
        (w) =>
          w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.address.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : walletLabels;

  const hasResults = filteredContacts.length > 0 || filteredWallets.length > 0;

  const handleSelectAddress = (address: string) => {
    onChange(address);
    setShowDropdown(false);
    setSearchQuery('');
  };

  const truncateAddress = (addr: string) => {
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1 items-center">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            id={id}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`font-mono pr-8 ${isCompact ? 'h-8' : ''} ${className}`}
          />
          {value && !disabled && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground"
            >
              <X className={isPopupMode || isCompact ? 'h-3 w-3' : 'h-3.5 w-5 pr-1'} />
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={disabled}
          className={isCompact ? 'h-8 w-8 flex-shrink-0' : 'h-9 w-9 flex-shrink-0'}
          title="Select from contacts"
        >
          <BookUser className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </Button>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          className={`absolute z-50 w-full bg-background border rounded-md shadow-lg overflow-hidden ${
            dropdownPosition === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search
                className={`absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground ${
                  isPopupMode ? 'h-3 w-3' : 'h-4 w-4'
                }`}
              />
              <Input
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${isPopupMode ? 'h-7 text-xs pl-7' : 'h-8 pl-8'}`}
                autoFocus
              />
            </div>
          </div>

          <ScrollArea className={isPopupMode ? 'h-[140px]' : 'h-[200px]'}>
            {!hasResults ? (
              <div
                className={`text-center py-4 text-muted-foreground ${
                  isPopupMode ? 'text-xs' : 'text-sm'
                }`}
              >
                {searchQuery ? 'No results found' : 'No contacts or wallets'}
              </div>
            ) : (
              <div className="p-1">
                {/* Contacts Section */}
                {filteredContacts.length > 0 && (
                  <div>
                    <div
                      className={`px-2 py-1 text-muted-foreground font-medium ${
                        isPopupMode ? 'text-[10px]' : 'text-xs'
                      }`}
                    >
                      Contacts
                    </div>
                    {filteredContacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => handleSelectAddress(contact.address)}
                        className={`w-full text-left px-2 py-1.5 hover:bg-accent rounded-sm ${
                          isPopupMode ? 'text-xs' : 'text-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{contact.label}</span>
                          {contact.tags.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {CONTACT_TAGS.find((t) => t.value === contact.tags[0])?.icon}
                            </span>
                          )}
                        </div>
                        <div
                          className={`font-mono text-muted-foreground ${
                            isPopupMode ? 'text-[10px]' : 'text-xs'
                          }`}
                        >
                          {truncateAddress(contact.address)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Wallets Section */}
                {filteredWallets.length > 0 && (
                  <div className={filteredContacts.length > 0 ? 'mt-2 pt-2' : ''}>
                    <div
                      className={`px-2 py-1 text-muted-foreground font-medium ${
                        isPopupMode ? 'text-[10px]' : 'text-xs'
                      }`}
                    >
                      My Wallets
                    </div>
                    {filteredWallets.map((wallet) => (
                      <button
                        key={wallet.address}
                        type="button"
                        onClick={() => handleSelectAddress(wallet.address)}
                        className={`w-full text-left px-2 py-1.5 hover:bg-accent rounded-sm ${
                          isPopupMode ? 'text-xs' : 'text-sm'
                        }`}
                      >
                        <div className="font-medium truncate">{wallet.name}</div>
                        <div
                          className={`font-mono text-muted-foreground ${
                            isPopupMode ? 'text-[10px]' : 'text-xs'
                          }`}
                        >
                          {truncateAddress(wallet.address)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
