import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Edit2 } from 'lucide-react';
import { WalletLabel } from '../types/addressBook';
import { addressBook } from '../utils/addressBook';

interface WalletLabelEditorProps {
  address: string;
  isPopupMode?: boolean;
  onLabelChange?: (label: WalletLabel | undefined) => void;
}

export function WalletLabelEditor({
  address,
  isPopupMode = false,
  onLabelChange,
}: WalletLabelEditorProps) {
  const [label, setLabel] = useState<WalletLabel | undefined>();
  const [showDialog, setShowDialog] = useState(false);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLabel();
    const unsubscribe = addressBook.subscribe(loadLabel);
    return unsubscribe;
  }, [address]);

  const loadLabel = () => {
    const l = addressBook.getWalletLabel(address);
    setLabel(l);
    onLabelChange?.(l);
  };

  const openEditor = () => {
    setEditName(label?.name || '');
    setError(null);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      setError('Name is required');
      return;
    }

    setError(null);
    await addressBook.setWalletLabel(address, editName.trim());
    setShowDialog(false);
  };

  const handleRemove = async () => {
    await addressBook.removeWalletLabel(address);
    setShowDialog(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={openEditor}
        className={`${isPopupMode ? 'h-6 w-6' : 'h-7 w-7'} p-0`}
        title="Edit wallet name"
      >
        <Edit2 className={isPopupMode ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className={isPopupMode ? 'w-[300px] p-4' : 'sm:max-w-xs'}>
          <DialogHeader className={isPopupMode ? 'pb-2' : ''}>
            <DialogTitle className={isPopupMode ? 'text-sm' : ''}>
              Edit Wallet Name
            </DialogTitle>
            <DialogDescription className="sr-only">
              Customize your wallet name
            </DialogDescription>
          </DialogHeader>

          <div className={`space-y-4 ${isPopupMode ? 'space-y-3' : ''}`}>
            {/* Name Input */}
            <div className="space-y-1.5">
              <Input
                placeholder="Wallet name"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  if (error) setError(null);
                }}
                className={`${isPopupMode ? 'h-8 text-xs' : ''} ${error ? 'border-red-500' : ''}`}
              />
              {error && (
                <p className={`text-red-500 ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
                  {error}
                </p>
              )}
            </div>

            {/* Preview */}
            <div
              className={`bg-muted/50 p-2 text-center ${isPopupMode ? 'text-xs' : 'text-sm'}`}
            >
              Preview: <span className="font-medium">{editName || 'Wallet'}</span>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {label && (
                <Button
                  variant="outline"
                  onClick={handleRemove}
                  className={`text-red-500 hover:text-red-700 ${isPopupMode ? 'h-8 text-xs' : ''}`}
                >
                  Remove
                </Button>
              )}
              <div className="flex-1" />
              <Button
                variant="outline"
                onClick={() => setShowDialog(false)}
                className={isPopupMode ? 'h-8 text-xs' : ''}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                className={`bg-[#3A4DFF] hover:bg-[#6C63FF]/90 ${isPopupMode ? 'h-8 text-xs' : ''}`}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Display component for wallet name
interface WalletDisplayNameProps {
  address: string;
  showAddress?: boolean;
  isPopupMode?: boolean;
  className?: string;
}

export function WalletDisplayName({
  address,
  showAddress = false,
  isPopupMode = false,
  className = '',
}: WalletDisplayNameProps) {
  const [label, setLabel] = useState<WalletLabel | undefined>();

  useEffect(() => {
    const loadLabel = () => setLabel(addressBook.getWalletLabel(address));
    loadLabel();
    const unsubscribe = addressBook.subscribe(loadLabel);
    return unsubscribe;
  }, [address]);

  const displayName = label?.name || `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <span className={className}>
      {displayName}
      {showAddress && label && (
        <span
          className={`text-muted-foreground ml-1 ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}
        >
          ({address.slice(0, 6)}...{address.slice(-4)})
        </span>
      )}
    </span>
  );
}
