/**
 * DraggableWalletList - Drag and drop wallet list component
 * Supports reordering wallets via drag-and-drop in both expanded and popup modes
 */

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Copy, Check, Trash2, GripVertical } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { WalletLabelEditor, WalletDisplayName } from './WalletLabelEditor';
import { fetchBalance } from '../utils/api';

interface SortableWalletItemProps {
  wallet: Wallet;
  index: number;
  isActive: boolean;
  nonce: number;
  walletNonces: Record<string, number | null>;
  setWalletNonces: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  onSwitchWallet: (wallet: Wallet) => void;
  onCopyAddress: (address: string, fieldId: string) => void;
  onDeleteWallet: (wallet: Wallet) => void;
  copiedField: string | null;
  walletsCount: number;
  isPopupMode: boolean;
  closeSelector?: () => void;
}

function SortableWalletItem({
  wallet,
  index,
  isActive,
  nonce,
  walletNonces,
  setWalletNonces,
  onSwitchWallet,
  onCopyAddress,
  onDeleteWallet,
  copiedField,
  walletsCount,
  isPopupMode,
  closeSelector,
}: SortableWalletItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: wallet.address });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  const shortAddress = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-5)}`;
  const walletType = wallet.type === 'generated' ? 'Generated' 
    : wallet.type === 'imported-mnemonic' ? 'Imported (Mnemonic)' 
    : wallet.type === 'imported-private-key' ? 'Imported (Key)' 
    : '';
  
  const walletNonce = isActive ? nonce : walletNonces[wallet.address];
  
  const handleMouseEnter = async () => {
    if (!isActive && walletNonces[wallet.address] === undefined) {
      try {
        const balanceData = await fetchBalance(wallet.address);
        setWalletNonces(prev => ({ ...prev, [wallet.address]: balanceData.nonce }));
      } catch {
        setWalletNonces(prev => ({ ...prev, [wallet.address]: null }));
      }
    }
  };

  const fieldId = isPopupMode ? `walletPopup-${wallet.address}` : `sidebarWallet-${wallet.address}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative ${isPopupMode ? 'py-2.5 pl-4 pr-4' : 'py-3 pl-4 pr-3'} cursor-pointer transition-all duration-200 ${
        isActive ? '' : 'hover:bg-accent/50'
      } ${isDragging ? 'bg-accent shadow-lg rounded-md' : ''}`}
      onClick={() => {
        onSwitchWallet(wallet);
        closeSelector?.();
      }}
      onMouseEnter={handleMouseEnter}
    >
      {/* Active indicator bar - left side */}
      <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-[#0000db] transition-all duration-200 ${
        isActive ? (isPopupMode ? 'h-8' : 'h-10') + ' opacity-100' : 'h-0 opacity-0'
      }`} />
      
      {/* Content wrapper */}
      <div className="pl-2 flex items-start gap-2">
        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className={`flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity ${
            isPopupMode ? 'mt-0.5' : 'mt-1'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className={`${isPopupMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-muted-foreground`} />
        </div>
        
        <div className="flex-1 min-w-0">
          {/* Row 1: Number + Address + Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`${isPopupMode ? 'text-[10px]' : 'text-xs'} font-medium px-1.5 py-0.5 rounded ${
                isActive ? 'bg-[#0000db] text-white' : 'bg-muted text-muted-foreground'
              }`}>
                {index + 1}
              </span>
              <span className={`font-mono ${isPopupMode ? 'text-xs' : 'text-sm'} truncate ${isActive ? 'text-[#0000db] font-semibold' : ''}`}>
                {shortAddress}
              </span>
            </div>
            {/* Actions - hidden by default, show on hover */}
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyAddress(wallet.address, fieldId);
                }}
                className={`h-6 w-6 p-0 ${isActive ? 'text-[#0000db] hover:text-[#0000db]/80' : ''}`}
                title="Copy address"
              >
                {copiedField === fieldId ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </Button>
              <div onClick={(e) => e.stopPropagation()}>
                <WalletLabelEditor address={wallet.address} isPopupMode={isPopupMode} />
              </div>
              {walletsCount > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteWallet(wallet);
                    closeSelector?.();
                  }}
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                  title="Remove wallet"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          
          {/* Row 2: Wallet Name */}
          <div className={`mt-1 ${isPopupMode ? 'text-xs' : 'text-sm'} font-medium truncate ${isActive ? 'text-[#0000db]' : ''}`}>
            <WalletDisplayName address={wallet.address} isPopupMode={isPopupMode} />
          </div>
          
          {/* Row 3: Type + Nonce */}
          <div className={`flex items-center justify-between ${isPopupMode ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs'} ${
            isActive ? 'text-[#0000db]/70' : 'text-muted-foreground'
          }`}>
            <span>{walletType}</span>
            {isActive ? (
              <span>Nonce: {nonce}</span>
            ) : (
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                Nonce: {walletNonce !== undefined ? (walletNonce ?? '-') : '...'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// Overlay item for drag preview
function WalletDragOverlay({
  wallet,
  index,
  isPopupMode,
}: {
  wallet: Wallet;
  index: number;
  isPopupMode: boolean;
}) {
  const shortAddress = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-5)}`;
  const walletType = wallet.type === 'generated' ? 'Generated' 
    : wallet.type === 'imported-mnemonic' ? 'Imported (Mnemonic)' 
    : wallet.type === 'imported-private-key' ? 'Imported (Key)' 
    : '';

  return (
    <div className={`${isPopupMode ? 'py-2.5 pl-4 pr-4' : 'py-3 pl-4 pr-3'} bg-background border border-border rounded-md shadow-lg`}>
      <div className="pl-2 flex items-start gap-2">
        <div className={`flex-shrink-0 ${isPopupMode ? 'mt-0.5' : 'mt-1'}`}>
          <GripVertical className={`${isPopupMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-muted-foreground`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`${isPopupMode ? 'text-[10px]' : 'text-xs'} font-medium px-1.5 py-0.5 rounded bg-[#0000db] text-white`}>
              {index + 1}
            </span>
            <span className={`font-mono ${isPopupMode ? 'text-xs' : 'text-sm'} truncate text-[#0000db] font-semibold`}>
              {shortAddress}
            </span>
          </div>
          <div className={`mt-1 ${isPopupMode ? 'text-xs' : 'text-sm'} font-medium truncate text-[#0000db]`}>
            <WalletDisplayName address={wallet.address} isPopupMode={isPopupMode} />
          </div>
          <div className={`${isPopupMode ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs'} text-[#0000db]/70`}>
            <span>{walletType}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DraggableWalletListProps {
  wallets: Wallet[];
  activeWallet: Wallet;
  nonce: number;
  walletNonces: Record<string, number | null>;
  setWalletNonces: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  onSwitchWallet: (wallet: Wallet) => void;
  onCopyAddress: (address: string, fieldId: string) => void;
  onDeleteWallet: (wallet: Wallet) => void;
  onReorderWallets: (wallets: Wallet[]) => void;
  copiedField: string | null;
  isPopupMode: boolean;
  closeSelector?: () => void;
}

export function DraggableWalletList({
  wallets,
  activeWallet,
  nonce,
  walletNonces,
  setWalletNonces,
  onSwitchWallet,
  onCopyAddress,
  onDeleteWallet,
  onReorderWallets,
  copiedField,
  isPopupMode,
  closeSelector,
}: DraggableWalletListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const oldIndex = wallets.findIndex((w) => w.address === active.id);
      const newIndex = wallets.findIndex((w) => w.address === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const newWallets = arrayMove(wallets, oldIndex, newIndex);
        onReorderWallets(newWallets);
      }
    }
  };

  const activeWalletForOverlay = activeId ? wallets.find(w => w.address === activeId) : null;
  const activeIndexForOverlay = activeId ? wallets.findIndex(w => w.address === activeId) : -1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={wallets.map(w => w.address)}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y divide-dashed divide-border">
          {wallets.map((w, i) => (
            <SortableWalletItem
              key={w.address}
              wallet={w}
              index={i}
              isActive={w.address === activeWallet.address}
              nonce={nonce}
              walletNonces={walletNonces}
              setWalletNonces={setWalletNonces}
              onSwitchWallet={onSwitchWallet}
              onCopyAddress={onCopyAddress}
              onDeleteWallet={onDeleteWallet}
              copiedField={copiedField}
              walletsCount={wallets.length}
              isPopupMode={isPopupMode}
              closeSelector={closeSelector}
            />
          ))}
        </div>
      </SortableContext>
      
      <DragOverlay>
        {activeWalletForOverlay && (
          <WalletDragOverlay
            wallet={activeWalletForOverlay}
            index={activeIndexForOverlay}
            isPopupMode={isPopupMode}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
