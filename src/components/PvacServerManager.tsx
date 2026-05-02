import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Server, Plus, Edit2, Trash2, CheckCircle, XCircle,
  Loader2, X, Check, Wifi, RefreshCw
} from 'lucide-react';
import { pvacServerService, PvacServer } from '@/services/pvacServerService';
import { logger } from '@/utils/logger';

interface PvacServerManagerProps {
  onClose: () => void;
  onServerSelected?: () => void;
}

export function PvacServerManager({ onClose, onServerSelected }: PvacServerManagerProps) {
  const [servers, setServers] = useState<PvacServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<Record<string, 'ok' | 'fail' | 'checking'>>({});

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('http://localhost:8765');
  const [authToken, setAuthToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => { loadServers(); }, []);

  const loadServers = () => {
    setServers(pvacServerService.getAllServers());
    setActiveServerId(pvacServerService.getActiveServerId());
  };

  const resetForm = () => {
    setName('');
    setUrl('http://localhost:8765');
    setAuthToken('');
    setValidationResult(null);
    setIsAdding(false);
    setEditingId(null);
  };

  const handleTestServer = async (server: PvacServer) => {
    setTestingId(server.id);
    setServerStatus(prev => ({ ...prev, [server.id]: 'checking' }));
    try {
      const result = await pvacServerService.testConnection(server.url, server.authToken);
      setServerStatus(prev => ({ ...prev, [server.id]: result.success ? 'ok' : 'fail' }));
    } catch {
      setServerStatus(prev => ({ ...prev, [server.id]: 'fail' }));
    } finally {
      setTestingId(null);
    }
  };

  const handleValidate = async () => {
    if (!url.trim() || !authToken.trim()) {
      setValidationResult({ success: false, message: 'URL and auth token are required' });
      return;
    }
    setIsValidating(true);
    setValidationResult(null);
    try {
      const result = await pvacServerService.testConnection(url.trim(), authToken.trim());
      setValidationResult({
        success: result.success,
        message: result.success
          ? `Connected! Server version: ${result.version || 'unknown'}`
          : result.message,
      });
    } catch (err) {
      setValidationResult({ success: false, message: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = () => {
    if (!name.trim() || !url.trim() || !authToken.trim()) {
      setValidationResult({ success: false, message: 'All fields are required' });
      return;
    }
    if (!validationResult?.success) {
      setValidationResult({ success: false, message: 'Test connection first' });
      return;
    }
    try {
      if (editingId) {
        pvacServerService.updateServer(editingId, {
          name: name.trim(), url: url.trim(), authToken: authToken.trim(),
        });
        logger.info('PVAC server updated', { id: editingId });
      } else {
        pvacServerService.addServer({ name: name.trim(), url: url.trim(), authToken: authToken.trim() });
        logger.info('PVAC server added');
      }
      loadServers();
      resetForm();
    } catch (err) {
      setValidationResult({ success: false, message: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleEdit = (server: PvacServer) => {
    setEditingId(server.id);
    setName(server.name);
    setUrl(server.url);
    setAuthToken(server.authToken);
    setValidationResult(null);
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this PVAC server?')) return;
    pvacServerService.deleteServer(id);
    logger.info('PVAC server deleted', { id });
    loadServers();
  };

  const handleSetActive = (id: string) => {
    pvacServerService.setActiveServer(id);
    setActiveServerId(id);
    logger.info('PVAC server activated', { id });
    onServerSelected?.();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card border border-border shadow-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[#00E5C0]" />
            <h2 className="text-base font-semibold">PVAC Server Manager</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!isAdding ? (
            <>
              {/* Server list */}
              {servers.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Server className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No PVAC servers configured</p>
                  <p className="text-xs mt-1">Add a server to enable encrypted operations</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {servers.map((server) => {
                    const isActive = server.id === activeServerId;
                    const status = serverStatus[server.id];
                    return (
                      <div
                        key={server.id}
                        className={`p-3 border rounded-lg transition-colors ${
                          isActive ? 'border-[#00E5C0] bg-[#00E5C0]/5' : 'border-border hover:border-border/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{server.name}</span>
                              {isActive && (
                                <Badge className="bg-[#00E5C0] text-black text-[10px] px-1.5 py-0 h-4">Active</Badge>
                              )}
                              {status === 'ok' && <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                              {status === 'fail' && <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                              {status === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500 flex-shrink-0" />}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{server.url}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              Token: {server.authToken.substring(0, 8)}...{server.authToken.slice(-4)}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            {/* Test */}
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => handleTestServer(server)}
                              disabled={testingId === server.id}
                              className="h-7 w-7 p-0"
                              title="Test connection"
                            >
                              {testingId === server.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                            </Button>
                            {/* Set active */}
                            {!isActive && (
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => handleSetActive(server.id)}
                                className="h-7 w-7 p-0 text-[#00E5C0]"
                                title="Set as active"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {/* Edit */}
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => handleEdit(server)}
                              className="h-7 w-7 p-0"
                              title="Edit"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {/* Delete */}
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => handleDelete(server.id)}
                              disabled={isActive}
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600 disabled:opacity-30"
                              title={isActive ? 'Cannot delete active server' : 'Delete'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add button */}
              <Button
                onClick={() => setIsAdding(true)}
                className="w-full bg-[#00E5C0] hover:bg-[#00E5C0]/90 text-black"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Server
              </Button>
            </>
          ) : (
            /* Add / Edit form */
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{editingId ? 'Edit Server' : 'Add New Server'}</h3>

              <div className="space-y-1.5">
                <Label htmlFor="pvac-name" className="text-xs">Server Name *</Label>
                <Input id="pvac-name" placeholder="Local PVAC Server"
                  value={name} onChange={e => setName(e.target.value)} disabled={isValidating} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pvac-url" className="text-xs">Server URL *</Label>
                <Input id="pvac-url" placeholder="http://localhost:8765"
                  value={url} onChange={e => setUrl(e.target.value)} disabled={isValidating} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pvac-token" className="text-xs">Auth Token *</Label>
                <Input id="pvac-token" type="password" placeholder="Paste token from pvac_token file"
                  value={authToken} onChange={e => setAuthToken(e.target.value)} disabled={isValidating} />
                <p className="text-[10px] text-muted-foreground">
                  Found in <code className="bg-muted px-1 rounded">~/.octwa/pvac_token</code>
                </p>
              </div>

              {validationResult && (
                <Alert variant={validationResult.success ? 'default' : 'destructive'} className="py-2">
                  <div className="flex items-start gap-2">
                    {validationResult.success
                      ? <CheckCircle className="h-3.5 w-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />}
                    <AlertDescription className="text-xs">{validationResult.message}</AlertDescription>
                  </div>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleValidate}
                  disabled={isValidating || !url.trim() || !authToken.trim()}
                  variant="outline" className="flex-1"
                >
                  {isValidating
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Testing...</>
                    : <><Wifi className="h-3.5 w-3.5 mr-1.5" />Test Connection</>}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isValidating || !validationResult?.success}
                  className="flex-1 bg-[#00E5C0] hover:bg-[#00E5C0]/90 text-black"
                >
                  {editingId ? 'Update' : 'Save'}
                </Button>
              </div>

              <Button variant="ghost" onClick={resetForm} disabled={isValidating} className="w-full text-sm">
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Footer hint */}
        {!isAdding && servers.length > 0 && (
          <div className="px-4 py-2 border-t border-border flex-shrink-0">
            <p className="text-[10px] text-muted-foreground text-center">
              Click <RefreshCw className="h-2.5 w-2.5 inline" /> to test · <Check className="h-2.5 w-2.5 inline text-[#00E5C0]" /> to set active · <Edit2 className="h-2.5 w-2.5 inline" /> to edit
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
