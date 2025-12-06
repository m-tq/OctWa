import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Wifi, Plus, MoreVertical, Trash2, Star, Settings } from 'lucide-react';
import { RPCProvider } from '../types/wallet';
import { useToast } from '@/hooks/use-toast';

interface RPCProviderManagerProps {
  onClose?: () => void;
  onRPCChange?: () => void;
}

export function RPCProviderManager({ onClose, onRPCChange }: RPCProviderManagerProps) {
  const [providers, setProviders] = useState<RPCProvider[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<RPCProvider | null>(null);
  const { toast } = useToast();

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    headers: {} as Record<string, string>,
    priority: 1
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
    } else {
      // Initialize with default provider
      const defaultProvider: RPCProvider = {
        id: 'default',
        name: 'Octra Network (Default)',
        url: 'https://octra.network',
        headers: {},
        priority: 1,
        isActive: true,
        createdAt: Date.now()
      };
      setProviders([defaultProvider]);
      localStorage.setItem('rpcProviders', JSON.stringify([defaultProvider]));
    }
  };

  const saveProviders = (updatedProviders: RPCProvider[]) => {
    const sorted = updatedProviders.sort((a, b) => a.priority - b.priority);
    setProviders(sorted);
    localStorage.setItem('rpcProviders', JSON.stringify(sorted));
  };

  const resetForm = () => {
    setFormData({
      name: '',
      url: '',
      headers: {},
      priority: providers.length + 1
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
      priority: provider.priority
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
    
    // Log the change for debugging
    const newActiveProvider = updatedProviders.find(p => p.isActive);
    console.log('RPC provider changed to:', newActiveProvider?.name, newActiveProvider?.url);
    
    toast({
      title: "Primary Provider Set",
      description: "RPC provider has been set as primary",
    });
    
    // Trigger reload of wallet data with new RPC
    if (onRPCChange) {
      onRPCChange();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            RPC Providers
          </CardTitle>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={resetForm}>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingProvider ? 'Edit RPC Provider' : 'Add RPC Provider'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="provider-name">Connection Name</Label>
                  <Input
                    id="provider-name"
                    placeholder="e.g., Octra Mainnet"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="provider-url">URL</Label>
                  <Input
                    id="provider-url"
                    placeholder="https://octra.network"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    RPC URL will be tried directly first. If CORS fails, it will fallback to nginx proxy automatically.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="provider-priority">Priority (lower = higher priority)</Label>
                  <Input
                    id="provider-priority"
                    type="number"
                    min="1"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 1 })}
                  />
                </div>

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

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowAddDialog(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} className="flex-1">
                    {editingProvider ? 'Update' : 'Add'} Provider
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className={`flex items-center justify-between p-3 border rounded-lg ${
                  provider.isActive ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{provider.name}</span>
                    {provider.isActive && (
                      <Badge variant="default" className="text-xs">
                        Primary
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      P.{provider.priority}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground font-mono">
                    {provider.url}
                  </div>
                  {Object.keys(provider.headers).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {Object.keys(provider.headers).length} custom header(s)
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!provider.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetPrimary(provider.id)}
                      title="Set as primary"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(provider)}>
                        <Settings className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      {provider.id !== 'default' && (
                        <DropdownMenuItem 
                          onClick={() => handleDelete(provider.id)}
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
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