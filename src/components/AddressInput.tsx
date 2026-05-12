import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookUser, Search, X, Plus, AlertTriangle, Shield, Globe, Loader2 } from 'lucide-react';
import { useAddressBook } from '../hooks/useAddressBook';
import { OperationMode } from '../utils/modeStorage';
import {
  useOnsResolver,
  reverseOnsLookup,
  isOctAddress,
  isValidLabel,
  normalizeLabel,
} from '@/integrations/ons';

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  isPopupMode?: boolean;
  isCompact?: boolean;
  id?: string;
  activeWalletAddress?: string; // Current active wallet address to exclude from selection
  onAddToAddressBook?: (address: string) => void; // Callback to open add contact modal
  currentMode?: OperationMode; // Current operation mode for mode mismatch warning
  hideButtons?: boolean; // Hide inline buttons (for external button placement)
  onOpenContacts?: () => void; // Callback when contacts button is clicked (for external control)
}

// Separate component for address action buttons (to be placed in header)
interface AddressActionButtonsProps {
  value: string;
  onAddToAddressBook?: (address: string) => void;
  onOpenContacts: () => void;
  activeWalletAddress?: string;
  isCompact?: boolean;
  disabled?: boolean;
  contacts: Array<{ id: string; address: string; label: string; preferredMode?: string }>;
  walletLabels: Array<{ address: string; name: string }>;
}

export function AddressActionButtons({
  value,
  onAddToAddressBook,
  onOpenContacts,
  activeWalletAddress,
  isCompact = false,
  disabled = false,
  contacts,
  walletLabels,
}: AddressActionButtonsProps) {
  // Validate if address is valid OCT address
  const isValidAddress = (addr: string): boolean => {
    return /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(addr);
  };

  // Check if address exists in contacts or wallets
  const isAddressInBook = (addr: string): boolean => {
    const lowerAddr = addr.toLowerCase();
    return (
      contacts.some((c) => c.address.toLowerCase() === lowerAddr) ||
      walletLabels.some((w) => w.address.toLowerCase() === lowerAddr)
    );
  };

  // Show add button if: address is valid, not empty, not in address book, and not active wallet
  const showAddButton =
    value.trim() &&
    isValidAddress(value.trim()) &&
    !isAddressInBook(value.trim()) &&
    value.trim().toLowerCase() !== activeWalletAddress?.toLowerCase() &&
    onAddToAddressBook;

  return (
    <div className="flex gap-1">
      {showAddButton && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onAddToAddressBook?.(value.trim())}
          disabled={disabled}
          className={`${isCompact ? 'h-7 w-7' : 'h-8 w-8'} flex-shrink-0 text-[#3B567F] hover:text-[#6C63FF] hover:bg-[#6C63FF]/10 border-[#3B567F]/30`}
          title="Add to address book"
        >
          <Plus className={isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onOpenContacts}
        disabled={disabled}
        className={`${isCompact ? 'h-7 w-7' : 'h-8 w-8'} flex-shrink-0`}
        title="Select from contacts"
      >
        <BookUser className={isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </Button>
    </div>
  );
}

export function AddressInput({
  value,
  onChange,
  placeholder = 'domain name or octra address',
  disabled = false,
  className = '',
  isPopupMode = false,
  isCompact = false,
  id,
  activeWalletAddress,
  onAddToAddressBook,
  currentMode = 'public',
  hideButtons = false,
  onOpenContacts,
}: AddressInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const { contacts, walletLabels } = useAddressBook();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── ONS resolver integration ──────────────────────────────────────────
  //
  // When the user types a label like `alice` or `alice.oct`, resolve it to
  // an address in the background. Once resolved we render an ENS-style
  // "resolved card" over the input showing the name + truncated address,
  // and silently commit the resolved address back to `value` so every
  // downstream validator (which expects /oct…/ regex) sees a proper address.
  //
  // A separate chip shows the primary ONS name when the user pastes a raw
  // oct address that has `primary_of` set on chain.

  // `pendingLabel` is the label the user typed but that we haven't committed
  // yet. It's what the resolver card displays while the user sees an address
  // in `value` (we substituted it silently once resolution succeeded).
  const [pendingLabel, setPendingLabel] = useState<string>('');

  const ons = useOnsResolver(value, { enabled: !disabled });
  const [reverseName, setReverseName] = useState<string>('');

  // Reverse lookup for raw oct addresses → primary name (enriches display).
  useEffect(() => {
    if (!value || !isOctAddress(value.trim())) {
      setReverseName('');
      return;
    }
    let cancelled = false;
    reverseOnsLookup(value.trim())
      .then((name) => { if (!cancelled) setReverseName(name); })
      .catch(() => { if (!cancelled) setReverseName(''); });
    return () => { cancelled = true; };
  }, [value]);

  // Auto-commit a resolved label → address substitution so parent validators
  // always see a valid oct address when the resolver finishes.
  useEffect(() => {
    if (ons.state !== 'resolved') return;
    if (!ons.address) return;
    const current = value.trim();
    if (isOctAddress(current)) return;                    // already an address
    if (current.toLowerCase() === ons.address.toLowerCase()) return;
    const label = normalizeLabel(current);
    setPendingLabel(label);
    onChange(ons.address);
  }, [ons.state, ons.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the remembered label whenever the input empties or diverges from
  // the resolved address (e.g. user pasted a different address).
  useEffect(() => {
    if (!value) { setPendingLabel(''); return; }
    if (!isOctAddress(value.trim())) return;   // still a label, keep showing
    if (pendingLabel && ons.state === 'resolved' && value.trim() === ons.address) return;
    // Address replaced externally by something other than our resolver.
    if (pendingLabel && value.trim() !== ons.address) setPendingLabel('');
  }, [value, pendingLabel, ons.state, ons.address]);

  // Is the current `value` a label the user is actively typing (not yet
  // resolved to an address)?
  const inputIsLabel = !!value.trim() && !isOctAddress(value.trim()) && isValidLabel(normalizeLabel(value.trim()));

  // Display an ENS-style resolved card when the input holds an address that
  // maps to an ONS name we resolved locally (pendingLabel) or that the chain
  // has a primary-name for (reverseName).
  const showResolvedCard = !!value.trim() && isOctAddress(value.trim()) && (!!pendingLabel || !!reverseName);
  const displayName = pendingLabel || reverseName;

  const handleClearResolved = () => {
    setPendingLabel('');
    onChange('');
  };

  // Hide the address-book button once the user has committed to a recipient
  // (valid oct address OR a well-formed ONS label that will resolve). The
  // clear X inside the input or resolved card is enough — showing another
  // button next to it just adds visual noise.
  const inputHasRecipient =
    !!value.trim() &&
    (isOctAddress(value.trim()) || isValidLabel(normalizeLabel(value.trim())));
  const shouldShowContactsButton = !inputHasRecipient;

  // Call onOpenContacts callback when dropdown opens (for external control)
  useEffect(() => {
    if (onOpenContacts && showDropdown) {
      // This is handled internally now
    }
  }, [showDropdown, onOpenContacts]);

  // Validate if address is valid OCT address
  const isValidAddress = (addr: string): boolean => {
    return /^oct[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(addr);
  };

  // Check if address exists in contacts or wallets
  const isAddressInBook = (addr: string): boolean => {
    const lowerAddr = addr.toLowerCase();
    return (
      contacts.some((c) => c.address.toLowerCase() === lowerAddr) ||
      walletLabels.some((w) => w.address.toLowerCase() === lowerAddr)
    );
  };

  // Show add button if: address is valid, not empty, not in address book, and not active wallet
  const showAddButton =
    value.trim() &&
    isValidAddress(value.trim()) &&
    !isAddressInBook(value.trim()) &&
    value.trim().toLowerCase() !== activeWalletAddress?.toLowerCase() &&
    onAddToAddressBook;

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
          w.address.toLowerCase() !== activeWalletAddress?.toLowerCase() &&
          (w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.address.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : walletLabels.filter(
        (w) => w.address.toLowerCase() !== activeWalletAddress?.toLowerCase()
      );

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
      {showResolvedCard ? (
        // ENS-style resolved card replaces the input when a name has been
        // resolved to an oct address. The underlying `value` stays the
        // resolved address so downstream validators and tx builders see a
        // real oct... string.
        <div className="flex gap-1 items-center">
          <div
            className={`flex-1 flex items-center gap-2 border rounded-md bg-muted/30 ${
              isCompact ? 'px-2 py-1.5' : 'px-3 py-2'
            }`}
            role="status"
            aria-label={`Resolved ${displayName}.oct to ${value}`}
          >
            <div className={`flex-shrink-0 flex items-center justify-center bg-[#3B567F] text-white rounded-md ${
              isCompact ? 'h-7 w-7' : 'h-9 w-9'
            }`}>
              <Globe className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className={`font-semibold truncate ${isCompact ? 'text-xs' : 'text-sm'}`}>
                {displayName}<span className="text-muted-foreground">.oct</span>
              </div>
              <div className={`font-mono text-muted-foreground truncate ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                {truncateAddress(value)}
              </div>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={handleClearResolved}
                className={`flex-shrink-0 text-muted-foreground hover:text-foreground ${
                  isCompact ? 'h-6 w-6' : 'h-7 w-7'
                } flex items-center justify-center`}
                title="Clear"
              >
                <X className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </button>
            )}
          </div>
        </div>
      ) : (
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
              className="absolute right-2 inset-y-0 flex items-center text-muted-foreground hover:text-foreground"
            >
              <X className={isPopupMode || isCompact ? 'h-3 w-3 mr-2' : 'h-3.5 w-3.5 mr-3'} />
            </button>
          )}
        </div>
        {!hideButtons && (
          <>
            {showAddButton && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onAddToAddressBook?.(value.trim())}
                disabled={disabled}
                className={`${isCompact ? 'h-8 w-8' : 'h-8 w-8'} flex-shrink-0 text-[#3B567F] hover:text-[#6C63FF] hover:bg-[#6C63FF]/10 border-[#3B567F]/30`}
                title="Add to address book"
              >
                <Plus className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </Button>
            )}
            {shouldShowContactsButton && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={disabled}
                className={isCompact ? 'h-8 w-8 flex-shrink-0' : 'h-8 w-8 flex-shrink-0'}
                title="Select from contacts"
              >
                <BookUser className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </Button>
            )}
          </>
        )}
      </div>
      )}

      {/* Inline status while a label is being resolved */}
      {inputIsLabel && ons.state === 'pending' && (
        <div className={`mt-1.5 flex items-center gap-1.5 border rounded-md px-2 py-1 border-muted bg-muted/20 ${
          isPopupMode ? 'text-[10px]' : 'text-xs'
        }`}>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
          <span className="font-mono truncate">
            <span className="text-muted-foreground">{normalizeLabel(value.trim())}.oct → resolving…</span>
          </span>
        </div>
      )}
      {inputIsLabel && ons.state === 'not-found' && (
        <div className={`mt-1.5 flex items-center gap-1.5 border rounded-md px-2 py-1 border-yellow-500/40 bg-yellow-500/5 ${
          isPopupMode ? 'text-[10px]' : 'text-xs'
        }`}>
          <AlertTriangle className="h-3 w-3 text-yellow-600 flex-shrink-0" />
          <span className="font-mono truncate">
            <span className="text-yellow-700 dark:text-yellow-400">{normalizeLabel(value.trim())}.oct not registered on this network</span>
          </span>
        </div>
      )}
      {inputIsLabel && ons.state === 'error' && (
        <div className={`mt-1.5 flex items-center gap-1.5 border rounded-md px-2 py-1 border-destructive/40 bg-destructive/5 ${
          isPopupMode ? 'text-[10px]' : 'text-xs'
        }`}>
          <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />
          <span className="font-mono truncate text-destructive">{ons.error || 'lookup failed'}</span>
        </div>
      )}

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
                    {filteredContacts.map((contact) => {
                      const hasModeWarning = contact.preferredMode && contact.preferredMode !== currentMode;
                      
                      return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => handleSelectAddress(contact.address)}
                        className={`w-full text-left px-2 py-1.5 hover:bg-accent rounded-sm ${
                          isPopupMode ? 'text-xs' : 'text-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="font-medium truncate">{contact.label}</span>
                            {contact.preferredMode && (
                              contact.preferredMode === 'private' ? (
                                <Shield className={`text-[#00E5C0] flex-shrink-0 ${isPopupMode ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} />
                              ) : (
                                <Globe className={`text-green-600 flex-shrink-0 ${isPopupMode ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} />
                              )
                            )}
                          </div>
                          {hasModeWarning && (
                            <AlertTriangle className={`text-yellow-600 flex-shrink-0 ${isPopupMode ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
                          )}
                        </div>
                        <div
                          className={`font-mono text-muted-foreground truncate ${
                            isPopupMode ? 'text-[10px]' : 'text-xs'
                          }`}
                        >
                          {contact.domain
                            ? `${contact.domain}.oct`
                            : truncateAddress(contact.address)}
                        </div>
                        {hasModeWarning && (
                          <div className={`flex items-center gap-1 mt-0.5 text-yellow-700 ${isPopupMode ? 'text-[9px]' : 'text-[10px]'}`}>
                            <span>Prefers {contact.preferredMode} mode (current: {currentMode})</span>
                          </div>
                        )}
                      </button>
                      );
                    })}
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
