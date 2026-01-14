import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wifi, Plus, MoreVertical, Trash2, Star, Settings } from 'lucide-react';
import { RPCProvider } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';

interface RPCProviderManagerProps {
  onClose?: () => void;
  onRPCChange?: () => void;
  isPopupMode?: boolean;
}

export function RPCProviderManager({ onClose, onRPCChange, isPopupMode = false }: RPCProviderManagerProps) {
  const [providers, setProviders] = useState<RPCProvider[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<RPCProvider | null>(null);
  const { toast } = useToast();

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    headers: {} as Record<string, string>,
    priority: 1,
    network: 'mainnet' as 'mainnet' | 'testnet'
  });
  const [newHeaderKey, setNewHeaderKey] = useState('');
  const [newHeaderValue, setNewHeaderValue] = useState('');

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = () => {
    const savedProviders = localStorage.getItem('rpcProviders');
    if (savedProviders) {
      const parsed = JSON.parse(savedProviders);
      setProviders(parsed.sort((a: RPCProvider, b: RPCProvider) => a.priority - b.priority));
      
      // Sync to chrome.storage.local for background script access
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ rpcProviders: savedProviders }).catch(err => {
          console.warn('Failed to sync rpcProviders to chrome.storage:', err);
        });
        
        // Also sync the active network
        const activeProvider = parsed.find((p: RPCProvider) => p.isActive);
        const selectedNetwork = activeProvider?.network || 'mainnet';
        syncSelectedNetwork(selectedNetwork);
      }
    } else {
      // Initialize with default provider
      const defaultProvider: RPCProvider = {
        id: 'default',
        name: 'Octra Network (Default)',
        url: 'https://octra.network',
        headers: {},
        priority: 1,
        isActive: true,
        createdAt: Date.now(),
        network: 'mainnet'
      };
      setProviders([defaultProvider]);
      const providersJson = JSON.stringify([defaultProvider]);
      localStorage.setItem('rpcProviders', providersJson);
      
      // Also save to chrome.storage.local for background script access
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ 
          rpcProviders: providersJson,
          selectedNetwork: 'mainnet'
        }).catch(err => {
          console.warn('Failed to save rpcProviders to chrome.storage:', err);
        });
      }
    }
  };

  const saveProviders = (updatedProviders: RPCProvider[]) => {
    const sorted = updatedProviders.sort((a, b) => a.priority - b.priority);
    setProviders(sorted);
    localStorage.setItem('rpcProviders', JSON.stringify(sorted));
    
    // Also save to chrome.storage.local for background script access
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ rpcProviders: JSON.stringify(sorted) }).catch(err => {
        console.warn('Failed to save rpcProviders to chrome.storage:', err);
      });
    }
  };

  // Sync selected network to chrome.storage.local (for SDK/dApp access)
  const syncSelectedNetwork = (network: 'mainnet' | 'testnet') => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ selectedNetwork: network }).catch(err => {
        console.warn('Failed to save selectedNetwork to chrome.storage:', err);
      });
    }
    console.log('[RPCProviderManager] Network synced:', network);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      url: '',
      headers: {},
      priority: providers.length + 1,
      network: 'mainnet'
    });
    setNewHeaderKey('');
    setNewHeaderValue('');
    setEditingProvider(null);
  };

  const handleAddHeader = () => {
    if (newHeaderKey && newHeaderValue) {
      setFormData({
        ...formData,
        headers: {
          ...formData.headers,
          [newHeaderKey]: newHeaderValue
        }
      });
      setNewHeaderKey('');
      setNewHeaderValue('');
    }
  };

  const handleRemoveHeader = (key: string) => {
    const newHeaders = { ...formData.headers };
    delete newHeaders[key];
    setFormData({ ...formData, headers: newHeaders });
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.url) {
      toast({
        title: "Validation Error",
        description: "Name and URL are required",
        variant: "destructive",
      });
      return;
    }

    try {
      new URL(formData.url);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    if (editingProvider) {
      // Update existing provider
      const updatedProviders = providers.map(p => 
        p.id === editingProvider.id 
          ? { ...p, ...formData }
          : p
      );
      saveProviders(updatedProviders);
      
      // If editing the active provider, update selectedNetwork
      if (editingProvider.isActive) {
        syncSelectedNetwork(formData.network);
      }
      
      toast({
        title: "Provider Updated",
        description: "RPC provider has been updated successfully",
      });
    } else {
      // Add new provider
      const newProvider: RPCProvider = {
        id: Date.now().toString(),
        ...formData,
        isActive: false,
        createdAt: Date.now()
      };
      saveProviders([...providers, newProvider]);
      toast({
        title: "Provider Added",
        description: "New RPC provider has been added successfully",
      });
    }

    setShowAddDialog(false);
    resetForm();
  };

  const handleEdit = (provider: RPCProvider) => {
    setEditingProvider(provider);
    setFormData({
      name: provider.name,
      url: provider.url,
      headers: provider.headers,
      priority: provider.priority,
      network: provider.network || 'mainnet'
    });
    setShowAddDialog(true);
  };

  const handleDelete = (providerId: string) => {
    if (providers.length <= 1) {
      toast({
        title: "Cannot Delete",
        description: "You must have at least one RPC provider",
        variant: "destructive",
      });
      return;
    }

    const updatedProviders = providers.filter(p => p.id !== providerId);
    saveProviders(updatedProviders);
    toast({
      title: "Provider Deleted",
      description: "RPC provider has been deleted",
    });
  };

  const handleSetPrimary = (providerId: string) => {
    const updatedProviders = providers.map(p => ({
      ...p,
      isActive: p.id === providerId
    }));
    saveProviders(updatedProviders);
    
    // Get the new active provider
    const newActiveProvider = updatedProviders.find(p => p.isActive);
    console.log('RPC provider changed to:', newActiveProvider?.name, newActiveProvider?.url, 'network:', newActiveProvider?.network);
    
    // Sync selected network to chrome.storage.local for SDK/dApp access
    const selectedNetwork = newActiveProvider?.network || 'mainnet';
    syncSelectedNetwork(selectedNetwork);
    
    toast({
      title: "Primary Provider Set",
      description: `RPC provider set to ${newActiveProvider?.name} (${selectedNetwork})`,
    });
    
    // Trigger reload of wallet data with new RPC
    if (onRPCChange) {
      onRPCChange();
    }
  };

  return (
    <div className={isPopupMode ? "space-y-3" : "space-y-6"}>
      <Card className={isPopupMode ? "border-0 shadow-none" : ""}>
        <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${isPopupMode ? "p-0 pb-3" : "pb-4"}`}>
          <CardTitle className={`flex items-center gap-2 ${isPopupMode ? "text-sm" : ""}`}>
            <Wifi className={isPopupMode ? "h-4 w-4" : "h-5 w-5"} />
            RPC Providers
          </CardTitle>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={resetForm} className={isPopupMode ? "h-7 text-xs px-2" : ""}>
                <Plus className={isPopupMode ? "h-3 w-3 mr-1" : "h-4 w-4 mr-2"} />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent className={isPopupMode ? "w-[320px] p-3 z-[10001]" : "sm:max-w-md z-[10001]"} overlayClassName="z-[10000]">
              <DialogHeader className={isPopupMode ? "pb-2" : ""}>
                <DialogTitle className={isPopupMode ? "text-sm" : ""}>
                  {editingProvider ? 'Edit RPC Provider' : 'Add RPC Provider'}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Configure RPC provider connection settings
                </DialogDescription>
              </DialogHeader>
              <div className={isPopupMode ? "space-y-3" : "space-y-4"}>
                <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
                  <Label htmlFor="provider-name" className={isPopupMode ? "text-xs" : ""}>Connection Name</Label>
                  <Input
                    id="provider-name"
                    placeholder="e.g., Octra Mainnet"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={isPopupMode ? "h-8 text-xs" : ""}
                  />
                </div>

                <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
                  <Label htmlFor="provider-url" className={isPopupMode ? "text-xs" : ""}>URL</Label>
                  <Input
                    id="provider-url"
                    placeholder="https://octra.network"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    className={isPopupMode ? "h-8 text-xs" : ""}
                  />
                </div>

                <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
                  <Label htmlFor="provider-priority" className={isPopupMode ? "text-xs" : ""}>Priority</Label>
                  <Input
                    id="provider-priority"
                    type="number"
                    min="1"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 1 })}
                    className={isPopupMode ? "h-8 text-xs" : ""}
                  />
                </div>

                <div className={isPopupMode ? "space-y-1" : "space-y-2"}>
                  <Label htmlFor="provider-network" className={isPopupMode ? "text-xs" : ""}>Network</Label>
                  <Select
                    value={formData.network}
                    onValueChange={(value: 'mainnet' | 'testnet') => setFormData({ ...formData, network: value })}
                  >
                    <SelectTrigger className={isPopupMode ? "h-8 text-xs" : ""}>
                      <SelectValue placeholder="Select network" />
                    </SelectTrigger>
                    <SelectContent className="z-[10002]">
                      <SelectItem value="mainnet">Mainnet</SelectItem>
                      <SelectItem value="testnet">Testnet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {!isPopupMode && (
                  <div className="space-y-2">
                    <Label>Headers</Label>
                    <div className="space-y-2">
                      {Object.entries(formData.headers).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <div className="flex-1 text-sm font-mono bg-muted p-2 rounded">
                            {key}: {value}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveHeader(key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Header key"
                          value={newHeaderKey}
                          onChange={(e) => setNewHeaderKey(e.target.value)}
                          className="flex-1"
                        />
                        <Input
                          placeholder="Header value"
                          value={newHeaderValue}
                          onChange={(e) => setNewHeaderValue(e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAddHeader}
                          disabled={!newHeaderKey || !newHeaderValue}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowAddDialog(false)}
                    className={`flex-1 ${isPopupMode ? "h-8 text-xs" : ""}`}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} className={`flex-1 ${isPopupMode ? "h-8 text-xs" : ""}`}>
                    {editingProvider ? 'Update' : 'Add'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className={isPopupMode ? "p-0" : ""}>
          <div className={isPopupMode ? "space-y-2" : "space-y-3"}>
            {providers.map((provider) => (
              <div
                key={provider.id}
                className={`flex items-center justify-between ${isPopupMode ? "p-2" : "p-3"} border  ${
                  provider.isActive ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium truncate ${isPopupMode ? "text-xs" : ""}`}>{provider.name}</span>
                    {provider.isActive && (
                      <Badge variant="default" className={isPopupMode ? "text-[10px] px-1 py-0" : "text-xs"}>
                        Primary
                      </Badge>
                    )}
                    <Badge 
                      variant={provider.network === 'mainnet' ? 'secondary' : 'outline'} 
                      className={isPopupMode ? "text-[10px] px-1 py-0" : "text-xs"}
                    >
                      {provider.network || 'mainnet'}
                    </Badge>
                  </div>
                  <div className={`text-muted-foreground font-mono truncate ${isPopupMode ? "text-[10px]" : "text-sm"}`}>
                    {provider.url}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!provider.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetPrimary(provider.id)}
                      title="Set as primary"
                      className={isPopupMode ? "h-6 w-6 p-0" : ""}
                    >
                      <Star className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className={isPopupMode ? "h-6 w-6 p-0" : ""}>
                        <MoreVertical className={isPopupMode ? "h-3 w-3" : "h-4 w-4"} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[9999]">
                      <DropdownMenuItem onClick={() => handleEdit(provider)} className={isPopupMode ? "text-xs" : ""}>
                        <Settings className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} mr-2`} />
                        Edit
                      </DropdownMenuItem>
                      {provider.id !== 'default' && (
                        <DropdownMenuItem 
                          onClick={() => handleDelete(provider.id)}
                          className={`text-red-600 ${isPopupMode ? "text-xs" : ""}`}
                        >
                          <Trash2 className={`${isPopupMode ? "h-3 w-3" : "h-4 w-4"} mr-2`} />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
