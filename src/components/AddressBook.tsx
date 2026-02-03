import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  BookUser,
  Plus,
  Search,
  Edit2,
  Trash2,
  Copy,
  Check,
  Send,
  AlertTriangle,
  Globe,
  Shield,
  Download,
  Upload,
} from 'lucide-react';
import { Contact, ContactTag, CONTACT_TAGS } from '../types/addressBook';
import { addressBook } from '../utils/addressBook';
import { useToast } from '@/hooks/use-toast';

interface AddressBookProps {
  isPopupMode?: boolean;
  onSelectContact?: (contact: Contact) => void;
  currentMode?: 'public' | 'private';
  prefilledAddress?: string; // Pre-filled address for add contact
}

export function AddressBook({
  isPopupMode = false,
  onSelectContact,
  currentMode = 'public',
  prefilledAddress,
}: AddressBookProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();

  // Form state
  const [formLabel, setFormLabel] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formTags, setFormTags] = useState<ContactTag[]>([]);
  const [formNote, setFormNote] = useState('');
  const [formPreferredMode, setFormPreferredMode] = useState<
    'public' | 'private' | undefined
  >();

  useEffect(() => {
    loadContacts();
    const unsubscribe = addressBook.subscribe(loadContacts);
    return unsubscribe;
  }, []);

  // Auto-open add dialog with pre-filled address
  useEffect(() => {
    if (prefilledAddress && prefilledAddress.trim()) {
      resetForm();
      setFormAddress(prefilledAddress.trim());
      setShowAddDialog(true);
    }
  }, [prefilledAddress]);

  const loadContacts = () => {
    setContacts(addressBook.getContacts());
  };

  const filteredContacts = searchQuery
    ? addressBook.searchContacts(searchQuery)
    : contacts;

  const resetForm = () => {
    setFormLabel('');
    setFormAddress('');
    setFormTags([]);
    setFormNote('');
    setFormPreferredMode(undefined);
    setEditingContact(null);
    setFormError(null);
  };

  const openEditDialog = (contact: Contact) => {
    setEditingContact(contact);
    setFormLabel(contact.label);
    setFormAddress(contact.address);
    setFormTags(contact.tags);
    setFormNote(contact.note || '');
    setFormPreferredMode(contact.preferredMode);
    setFormError(null);
    setShowAddDialog(true);
  };

  const handleSave = async () => {
    setFormError(null);

    if (!formLabel.trim() || !formAddress.trim()) {
      setFormError('Label and address are required');
      return;
    }

    // Validate address format (OCT address check)
    if (!formAddress.startsWith('oct') || formAddress.length !== 47) {
      setFormError('Invalid address format (must be oct... with 47 characters)');
      return;
    }

    try {
      if (editingContact) {
        await addressBook.updateContact(editingContact.id, {
          label: formLabel.trim(),
          address: formAddress.trim(),
          tags: formTags,
          note: formNote.trim() || undefined,
          preferredMode: formPreferredMode,
        });
        toast({ title: 'Success', description: 'Contact updated' });
      } else {
        await addressBook.addContact({
          label: formLabel.trim(),
          address: formAddress.trim(),
          tags: formTags,
          note: formNote.trim() || undefined,
          preferredMode: formPreferredMode,
        });
        toast({ title: 'Success', description: 'Contact added' });
      }
      setShowAddDialog(false);
      resetForm();
    } catch (error) {
      setFormError((error as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    await addressBook.deleteContact(id);
    toast({ title: 'Deleted', description: 'Contact removed' });
  };

  const copyAddress = async (address: string, id: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSelectContact = (contact: Contact) => {
    // Check mode mismatch warning
    if (contact.preferredMode && contact.preferredMode !== currentMode) {
      toast({
        title: 'Mode Mismatch',
        description: `This contact prefers ${contact.preferredMode} mode. Current mode is ${currentMode}.`,
        variant: 'destructive',
      });
    }
    onSelectContact?.(contact);
  };

  const handleExport = () => {
    const data = JSON.stringify(contacts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `address-book-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: `${contacts.length} contacts exported` });
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const importedContacts = JSON.parse(text) as Contact[];
        
        if (!Array.isArray(importedContacts)) {
          throw new Error('Invalid format');
        }
        
        let imported = 0;
        for (const contact of importedContacts) {
          if (contact.label && contact.address) {
            try {
              await addressBook.addContact({
                label: contact.label,
                address: contact.address,
                tags: contact.tags || [],
                note: contact.note,
                preferredMode: contact.preferredMode,
              });
              imported++;
            } catch {
              // Skip duplicates or invalid contacts
            }
          }
        }
        
        toast({ title: 'Imported', description: `${imported} contacts imported` });
        loadContacts();
      } catch {
        toast({ title: 'Error', description: 'Failed to import contacts', variant: 'destructive' });
      }
    };
    input.click();
  };

  const toggleTag = (tag: ContactTag) => {
    setFormTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className={`flex flex-col ${isPopupMode ? 'h-full' : 'h-[500px]'}`}>
      {/* Header - More compact for popup */}
      <div
        className={`flex items-center justify-between ${isPopupMode ? 'pb-2' : 'pb-4'}`}
      >
        <div className="flex items-center gap-1.5">
          <BookUser className={isPopupMode ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
          <h3 className={`font-semibold ${isPopupMode ? 'text-xs' : 'text-base'}`}>
            Address Book
          </h3>
          <Badge
            variant="secondary"
            className={isPopupMode ? 'text-[9px] px-1 py-0' : 'text-xs'}
          >
            {contacts.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleImport}
            className={isPopupMode ? 'h-6 w-6 p-0' : 'h-8 w-8 p-0'}
            title="Import contacts"
          >
            <Upload className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleExport}
            disabled={contacts.length === 0}
            className={isPopupMode ? 'h-6 w-6 p-0' : 'h-8 w-8 p-0'}
            title="Export contacts"
          >
            <Download className={isPopupMode ? 'h-3 w-3' : 'h-4 w-4'} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              resetForm();
              setShowAddDialog(true);
            }}
            className={`text-[#3A4DFF] hover:text-[#6C63FF] hover:bg-[#6C63FF]/10 ${isPopupMode ? 'h-6 text-[10px] px-2' : ''}`}
          >
            <Plus className={isPopupMode ? 'h-3 w-3 mr-0.5' : 'h-4 w-4 mr-1.5'} />
            {isPopupMode ? 'Add' : 'Add'}
          </Button>
        </div>
      </div>

      {/* Search - More compact for popup */}
      <div className={`relative ${isPopupMode ? 'mb-2' : 'mb-3'}`}>
        <Search
          className={`absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground ${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`}
        />
        <Input
          placeholder={isPopupMode ? 'Search...' : 'Search contacts...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={`${isPopupMode ? 'h-7 text-[11px] pl-7' : 'pl-9'}`}
        />
      </div>

      {/* Contact List - More compact spacing for popup */}
      <ScrollArea className="flex-1">
        <div className={`${isPopupMode ? 'space-y-1.5 pr-2' : 'space-y-2 pr-3'}`}>
          {filteredContacts.length === 0 ? (
            <div
              className={`text-center text-muted-foreground ${isPopupMode ? 'py-6 text-[11px]' : 'py-8 text-sm'}`}
            >
              {searchQuery
                ? 'No contacts found'
                : 'No contacts yet. Add your first contact!'}
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                isPopupMode={isPopupMode}
                currentMode={currentMode}
                copiedId={copiedId}
                onEdit={() => openEditDialog(contact)}
                onDelete={() => handleDelete(contact.id)}
                onCopy={() => copyAddress(contact.address, contact.id)}
                onSelect={
                  onSelectContact ? () => handleSelectContact(contact) : undefined
                }
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add/Edit Dialog - More compact for popup mode */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          if (!open) resetForm();
          setShowAddDialog(open);
        }}
      >
        <DialogContent
          overlayClassName="z-[10000]"
          className={
            isPopupMode
              ? 'w-[95vw] max-w-[380px] h-[85vh] max-h-[520px] p-0 flex flex-col z-[10001]'
              : 'sm:max-w-md max-h-[80vh] flex flex-col z-[10001]'
          }
          preventCloseOnOutsideClick
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className={`px-4 ${isPopupMode ? 'pt-3 pb-2' : 'pt-4 pb-3'}`}>
            <DialogTitle className={isPopupMode ? 'text-xs' : ''}>
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editingContact
                ? 'Edit contact details'
                : 'Add a new contact to your address book'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1">
            <div className={`pb-3 px-4 ${isPopupMode ? 'space-y-2.5' : 'space-y-4'}`}>
              {/* Error Message */}
              {formError && (
                <div
                  className={`flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive ${isPopupMode ? 'p-1.5' : 'p-2'}`}
                >
                  <AlertTriangle
                    className={`flex-shrink-0 ${isPopupMode ? 'h-3 w-3' : 'h-4 w-4'}`}
                  />
                  <span className={isPopupMode ? 'text-[10px]' : 'text-xs'}>
                    {formError}
                  </span>
                </div>
              )}

              {/* Label */}
              <div className={isPopupMode ? 'space-y-1' : 'space-y-1.5'}>
                <Label className={isPopupMode ? 'text-[11px]' : 'text-sm'}>
                  Label *
                </Label>
                <Input
                  placeholder="e.g., Alice, Exchange"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  className={isPopupMode ? 'h-7 text-[11px]' : ''}
                />
              </div>

              {/* Address */}
              <div className={isPopupMode ? 'space-y-1' : 'space-y-1.5'}>
                <Label className={isPopupMode ? 'text-[11px]' : 'text-sm'}>
                  Address *
                </Label>
                <Input
                  placeholder="oct..."
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className={`font-mono ${isPopupMode ? 'h-7 text-[11px]' : ''}`}
                  disabled={!!editingContact}
                />
              </div>

              {/* Tags */}
              <div className={isPopupMode ? 'space-y-1' : 'space-y-1.5'}>
                <Label className={isPopupMode ? 'text-[11px]' : 'text-sm'}>Tags</Label>
                <div className={isPopupMode ? 'flex flex-wrap gap-1' : 'flex flex-wrap gap-1.5'}>
                  {CONTACT_TAGS.map((tag) => (
                    <Badge
                      key={tag.value}
                      variant="outline"
                      className={`cursor-pointer transition-colors ${isPopupMode ? 'text-[9px] px-1.5 py-0.5 h-5' : 'text-xs'} ${
                        formTags.includes(tag.value) ? tag.color : 'hover:bg-accent'
                      }`}
                      onClick={() => toggleTag(tag.value)}
                    >
                      {tag.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Preferred Mode */}
              <div className={isPopupMode ? 'space-y-1' : 'space-y-1.5'}>
                <Label className={isPopupMode ? 'text-[11px]' : 'text-sm'}>
                  Preferred Send Mode
                </Label>
                <div className={isPopupMode ? 'flex gap-1.5' : 'flex gap-2'}>
                  <Button
                    type="button"
                    variant={formPreferredMode === 'public' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      setFormPreferredMode(
                        formPreferredMode === 'public' ? undefined : 'public'
                      )
                    }
                    className={`flex-1 ${isPopupMode ? 'h-6 text-[10px]' : ''} ${formPreferredMode === 'public' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  >
                    <Globe
                      className={`${isPopupMode ? 'h-3 w-3 mr-0.5' : 'h-4 w-4 mr-1'}`}
                    />
                    Public
                  </Button>
                  <Button
                    type="button"
                    variant={formPreferredMode === 'private' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      setFormPreferredMode(
                        formPreferredMode === 'private' ? undefined : 'private'
                      )
                    }
                    className={`flex-1 ${isPopupMode ? 'h-6 text-[10px]' : ''} ${formPreferredMode === 'private' ? 'bg-[#00E5C0] hover:bg-[#6C63FF]/90' : ''}`}
                  >
                    <Shield
                      className={`${isPopupMode ? 'h-3 w-3 mr-0.5' : 'h-4 w-4 mr-1'}`}
                    />
                    Private
                  </Button>
                </div>
                <p
                  className={`text-muted-foreground ${isPopupMode ? 'text-[9px]' : 'text-xs'}`}
                >
                  Auto-warn if sending in different mode
                </p>
              </div>

              {/* Note */}
              <div className={isPopupMode ? 'space-y-1 pb-1' : 'space-y-1.5'}>
                <Label className={isPopupMode ? 'text-[11px]' : 'text-sm'}>
                  Note (optional)
                </Label>
                <Textarea
                  placeholder="e.g., Uses encrypted tx only"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className={isPopupMode ? 'text-[11px] min-h-[50px]' : 'min-h-[80px]'}
                />
              </div>
            </div>
          </ScrollArea>

          {/* Actions - Fixed at bottom, more compact for popup */}
          <div className={`flex gap-2 px-4 ${isPopupMode ? 'pb-3 pt-1' : 'pb-4 pt-1'}`}>
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setShowAddDialog(false);
              }}
              className={`flex-1 ${isPopupMode ? 'h-7 text-[10px]' : ''}`}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className={`flex-1 bg-[#3A4DFF] hover:bg-[#6C63FF]/90 ${isPopupMode ? 'h-7 text-[10px]' : ''}`}
            >
              {editingContact ? 'Save' : 'Add Contact'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Contact Card Component
interface ContactCardProps {
  contact: Contact;
  isPopupMode: boolean;
  currentMode: 'public' | 'private';
  copiedId: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onSelect?: () => void;
}

function ContactCard({
  contact,
  isPopupMode,
  currentMode,
  copiedId,
  onEdit,
  onDelete,
  onCopy,
  onSelect,
}: ContactCardProps) {
  const hasModeWarning =
    contact.preferredMode && contact.preferredMode !== currentMode;

  return (
    <div
      className={`border rounded-sm space-y-1.5 ${isPopupMode ? 'p-1.5' : 'p-3 space-y-2'} ${hasModeWarning ? 'border-yellow-500/50' : ''}`}
    >
      {/* Header Row - More compact for popup */}
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span
              className={`font-medium truncate ${isPopupMode ? 'text-[11px]' : 'text-sm'}`}
            >
              {contact.label}
            </span>
            {contact.preferredMode &&
              (contact.preferredMode === 'private' ? (
                <Shield
                  className={`text-[#00E5C0] flex-shrink-0 ${isPopupMode ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'}`}
                />
              ) : (
                <Globe
                  className={`text-green-600 flex-shrink-0 ${isPopupMode ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'}`}
                />
              ))}
          </div>
          <p
            className={`font-mono text-muted-foreground truncate ${isPopupMode ? 'text-[9px]' : 'text-xs'}`}
          >
            {isPopupMode 
              ? `${contact.address.slice(0, 8)}...${contact.address.slice(-6)}`
              : `${contact.address.slice(0, 10)}...${contact.address.slice(-8)}`
            }
          </p>
        </div>
        <div className={`flex items-center flex-shrink-0 ${isPopupMode ? 'gap-0' : 'gap-0.5'}`}>
          {onSelect && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelect}
              className={`${isPopupMode ? 'h-5 w-5' : 'h-7 w-7'} p-0`}
              title="Send to this contact"
            >
              <Send className={isPopupMode ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopy}
            className={`${isPopupMode ? 'h-5 w-5' : 'h-7 w-7'} p-0`}
            title="Copy address"
          >
            {copiedId === contact.id ? (
              <Check className={`text-green-500 ${isPopupMode ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} />
            ) : (
              <Copy className={isPopupMode ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className={`${isPopupMode ? 'h-5 w-5' : 'h-7 w-7'} p-0`}
            title="Edit"
          >
            <Edit2 className={isPopupMode ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className={`${isPopupMode ? 'h-5 w-5' : 'h-7 w-7'} p-0 text-red-500 hover:text-red-700`}
            title="Delete"
          >
            <Trash2 className={isPopupMode ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
          </Button>
        </div>
      </div>

      {/* Tags - More compact for popup */}
      {contact.tags.length > 0 && (
        <div className={isPopupMode ? 'flex flex-wrap gap-0.5' : 'flex flex-wrap gap-1'}>
          {contact.tags.map((tagValue) => {
            const tag = CONTACT_TAGS.find((t) => t.value === tagValue);
            if (!tag) return null;
            return (
              <Badge
                key={tagValue}
                variant="outline"
                className={`${tag.color} ${isPopupMode ? 'text-[8px] px-1 py-0 h-4' : 'text-[10px]'}`}
              >
                {tag.label}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Note - More compact for popup */}
      {contact.note && (
        <p
          className={`text-muted-foreground ${isPopupMode ? 'text-[9px]' : 'text-xs'}`}
        >
          📝 {contact.note}
        </p>
      )}

      {/* Mode Warning - More compact for popup */}
      {hasModeWarning && (
        <div
          className={`flex items-center gap-1.5 rounded-md border-yellow-500/50 bg-yellow-500/10 ${isPopupMode ? 'p-1' : 'p-2.5'}`}
        >
          <AlertTriangle
            className={`flex-shrink-0 text-yellow-600 ${isPopupMode ? 'h-2.5 w-2.5' : 'h-4 w-4'}`}
          />
          <span className={`text-yellow-700 ${isPopupMode ? 'text-[9px]' : 'text-xs'}`}>
            Prefers {contact.preferredMode} mode (current: {currentMode})
          </span>
        </div>
      )}
    </div>
  );
}
