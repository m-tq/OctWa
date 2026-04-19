import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Server, 
  Plus, 
  Edit2, 
  Trash2, 
  CheckCircle, 
  XCircle, 
  Loader2,
  X,
  Check
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
  
  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('http://localhost:8765');
  const [authToken, setAuthToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = () => {
    const allServers = pvacServerService.getAllServers();
    const active = pvacServerService.getActiveServerId();
    setServers(allServers);
    setActiveServerId(active);
  };

  const resetForm = () => {
    setName('');
    setUrl('http://localhost:8765');
    setAuthToken('');
    setValidationResult(null);
    setIsAdding(false);
    setEditingId(null);
  };

  const handleValidate = async () => {
    if (!url.trim()) {
      setValidationResult({
        success: false,
        message: 'Please enter server URL'
      });
      return;
    }

    if (!authToken.trim()) {
      setValidationResult({
        success: false,
        message: 'Auth token is required for secure communication'
      });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      // Test connection with provided credentials
      const result = await pvacServerService.testConnection(url.trim(), authToken.trim());

      if (result.success) {
        setValidationResult({
          success: true,
          message: `Connected successfully! Server version: ${result.version || 'unknown'}`
        });
      } else {
        setValidationResult({
          success: false,
          message: result.message || 'Connection failed'
        });
      }
    } catch (error: any) {
      logger.error('PVAC validation failed', error);
      setValidationResult({
        success: false,
        message: error.message || 'Connection failed'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !url.trim() || !authToken.trim()) {
      setValidationResult({
        success: false,
        message: 'Please fill all required fields'
      });
      return;
    }

    if (!validationResult?.success) {
      setValidationResult({
        success: false,
        message: 'Please test connection first'
      });
      return;
    }

    try {
      if (editingId) {
        // Update existing server
        pvacServerService.updateServer(editingId, {
          name: name.trim(),
          url: url.trim(),
          authToken: authToken.trim()
        });
        logger.info('PVAC server updated', { id: editingId });
      } else {
        // Add new server
        const newServer = pvacServerService.addServer({
          name: name.trim(),
          url: url.trim(),
          authToken: authToken.trim()
        });
        logger.info('PVAC server added', { id: newServer.id });
      }

      loadServers();
      resetForm();
    } catch (error: any) {
      logger.error('Failed to save PVAC server', error);
      setValidationResult({
        success: false,
        message: error.message || 'Failed to save server'
      });
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
    if (confirm('Are you sure you want to delete this server?')) {
      pvacServerService.deleteServer(id);
      logger.info('PVAC server deleted', { id });
      loadServers();
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      pvacServerService.setActiveServer(id);
      setActiveServerId(id);
      logger.info('PVAC server activated', { id });
      
      // Notify parent component
      if (onServerSelected) {
        onServerSelected();
      }
    } catch (error: any) {
      logger.error('Failed to activate PVAC server', error);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-card border border-border shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-[#00E5C0]" />
            <h2 className="text-lg font-semibold">PVAC Server Manager</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {!isAdding ? (
            <>
              {/* Server List */}
              <div className="space-y-2 mb-4">
                {servers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Server className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No PVAC servers configured</p>
                    <p className="text-xs mt-1">Add a server to get started</p>
                  </div>
                ) : (
                  servers.map((server) => (
                    <div
                      key={server.id}
                      className={`p-3 border rounded-lg ${
                        server.id === activeServerId
                          ? 'border-[#00E5C0] bg-[#00E5C0]/5'
                          : 'border-border'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{server.name}</h3>
                            {server.id === activeServerId && (
                              <span className="text-xs bg-[#00E5C0] text-black px-2 py-0.5 rounded">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{server.url}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Token: {server.authToken.substring(0, 16)}...
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {server.id !== activeServerId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetActive(server.id)}
                              title="Set as active"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(server)}
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(server.id)}
                            title="Delete"
                            disabled={server.id === activeServerId}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Button */}
              <Button
                onClick={() => setIsAdding(true)}
                className="w-full bg-[#00E5C0] hover:bg-[#00E5C0]/90 text-black"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Server
              </Button>
            </>
          ) : (
            <>
              {/* Add/Edit Form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="server-name">Server Name *</Label>
                  <Input
                    id="server-name"
                    type="text"
                    placeholder="My PVAC Server"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isValidating}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="server-url">Server URL *</Label>
                  <Input
                    id="server-url"
                    type="text"
                    placeholder="http://localhost:8765"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isValidating}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="server-token">Auth Token *</Label>
                  <Input
                    id="server-token"
                    type="password"
                    placeholder="Enter authentication token"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    disabled={isValidating}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for secure communication with PVAC server
                  </p>
                </div>

                {validationResult && (
                  <Alert variant={validationResult.success ? "default" : "destructive"}>
                    <div className="flex items-start gap-2">
                      {validationResult.success ? (
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 mt-0.5" />
                      )}
                      <AlertDescription className="text-sm">
                        {validationResult.message}
                      </AlertDescription>
                    </div>
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={handleValidate}
                    disabled={isValidating || !url.trim() || !authToken.trim()}
                    variant="outline"
                    className="flex-1"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Test Connection
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={isValidating || !validationResult?.success}
                    className="flex-1 bg-[#00E5C0] hover:bg-[#00E5C0]/90 text-black"
                  >
                    {editingId ? 'Update' : 'Save'}
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  onClick={resetForm}
                  disabled={isValidating}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
