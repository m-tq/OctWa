import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChainType } from '../utils/keyManager';
import { ChevronDown, Globe } from 'lucide-react';

interface ChainSelectorProps {
  selectedChain: ChainType;
  onSelectChain: (chain: ChainType) => void;
  className?: string;
}

export function ChainSelector({ selectedChain, onSelectChain, className }: ChainSelectorProps) {
  const chains = [
    { type: ChainType.EVM, name: 'Ethereum / EVM' },
    { type: ChainType.SOLANA, name: 'Solana' },
    { type: ChainType.BITCOIN, name: 'Bitcoin' },
    { type: ChainType.TRON, name: 'TRON' },
    { type: ChainType.COSMOS, name: 'Cosmos' },
  ];

  const currentChain = chains.find(c => c.type === selectedChain) || chains[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`justify-between ${className || 'w-full mb-4'}`}>
          <div className="flex items-center">
            <Globe className="mr-2 h-4 w-4" />
            {currentChain.name}
          </div>
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[200px]">
        {chains.map((chain) => (
          <DropdownMenuItem
            key={chain.type}
            onSelect={() => onSelectChain(chain.type)}
          >
            {chain.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
