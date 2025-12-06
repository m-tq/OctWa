import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Download, Eye, EyeOff, AlertTriangle, Shield, Key, FileText, Lock } from 'lucide-react';
import { Wallet } from '../types/wallet';
import { verifyPassword } from '../utils/password';
import { useToast } from '@/hooks/use-toast';

interface ExportPrivateKeysProps {
  wallet: Wallet | null;
}

export function ExportPrivateKeys({ wallet }: ExportPrivateKeysProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const { toast } = useToast();

  const handleVerifyPassword = async () => {
    if (!password) {
      toast({
        title: "Password Required",
        description: "Please enter your wallet password",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);

    try {
      const hashedPassword = localStorage.getItem('walletPasswordHash');
      const salt = localStorage.getItem('walletPasswordSalt');
      
      if (!hashedPassword || !salt) {
        toast({
          title: "No Password Set",
          description: "No wallet password found. Please set up password protection first.",
          variant: "destructive",
        });
        return;
      }

      const isValid = await verifyPassword(password, hashedPassword, salt);
      
      if (isValid) {
        setIsUnlocked(true);
        toast({
          title: "Access Granted",
          description: "Password verified successfully",
        });
      } else {
        toast({
          title: "Invalid Password",
          description: "The password you entered is incorrect",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Password verification error:', error);
      toast({
        title: "Verification Failed",
        description: "Failed to verify password",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Copy failed",
        variant: "destructive",
      });
    }
  };

  const exportToFile = (content: string, filename: string) => {
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Export Successful",
        description: `${filename} has been downloaded`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export file",
        variant: "destructive",
      });
    }
  };

  const exportPrivateKey = () => {
    if (!wallet) return;
    
    const content = `Octra Wallet Private Key Export
Generated: ${new Date().toISOString()}
Address: ${wallet.address}

PRIVATE KEY (Base64):
${wallet.privateKey}

⚠️  SECURITY WARNING:
- Keep this private key secure and never share it with anyone
- Anyone with access to this private key can control your wallet
- Store this file in a secure location and delete it after backing up
- Consider encrypting this file with additional password protection
`;

    exportToFile(content, `octra-private-key-${wallet.address.slice(0, 8)}.txt`);
  };

  const exportMnemonic = () => {
    if (!wallet || !wallet.mnemonic) return;
    
    const content = `Octra Wallet Mnemonic Export
Generated: ${new Date().toISOString()}
Address: ${wallet.address}

MNEMONIC PHRASE:
${wallet.mnemonic}

⚠️  SECURITY WARNING:
- Keep this mnemonic phrase secure and never share it with anyone
- Anyone with access to this mnemonic can control your wallet
- Store this file in a secure location and delete it after backing up
- Consider encrypting this file with additional password protection
- This mnemonic can be used to restore your wallet on any compatible wallet
`;

    exportToFile(content, `octra-mnemonic-${wallet.address.slice(0, 8)}.txt`);
  };

  const exportWalletInfo = () => {
    if (!wallet) return;
    
    const content = `Octra Wallet Complete Export
Generated: ${new Date().toISOString()}

WALLET ADDRESS:
${wallet.address}

PRIVATE KEY (Base64):
${wallet.privateKey}

${wallet.publicKey ? `PUBLIC KEY (Hex):
${wallet.publicKey}

` : ''}${wallet.mnemonic ? `MNEMONIC PHRASE:
${wallet.mnemonic}

` : ''}⚠️  CRITICAL SECURITY WARNING:
- This file contains ALL sensitive information needed to control your wallet
- Keep this information secure and never share it with anyone
- Anyone with access to this information can control your wallet and funds
- Store this file in a secure, encrypted location
- Delete this file after securely backing up the information
- Consider using hardware security keys or encrypted storage solutions
`;

    exportToFile(content, `octra-wallet-complete-${wallet.address.slice(0, 8)}.txt`);
  };

  const handleClose = () => {
    setIsOpen(false);
    setPassword('');
    setIsUnlocked(false);
    setShowPrivateKey(false);
    setShowMnemonic(false);
    setShowPassword(false);
  };

  if (!wallet) {
    return (
      <Alert>
        <div className="flex items-start space-x-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <AlertDescription>
            No wallet available. Please generate or import a wallet first.
          </AlertDescription>
        </div>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Export Private Keys
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className="mb-4">
          <div className="flex items-start space-x-3">
            <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <AlertDescription>
              Export your private keys and mnemonic phrase securely. Password verification required for access.
            </AlertDescription>
          </div>
        </Alert>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="w-full" size="lg">
              <Lock className="h-4 w-4 mr-2" />
              Export Private Keys
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh]" onInteractOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Export Private Keys
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[calc(90vh-100px)] pr-2">
              <div className="pr-2">
                {!isUnlocked ? (
                  <div className="space-y-4">
                    <Alert>
                      <div className="flex items-start space-x-3">
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <AlertDescription>
                          Enter your wallet password to access private key information. This is required for security purposes.
                        </AlertDescription>
                      </div>
                    </Alert>

                    <div className="space-y-2">
                      <Label htmlFor="password">Wallet Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter your wallet password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && handleVerifyPassword()}
                          className="pr-10"
                          disabled={isVerifying}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                          disabled={isVerifying}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={isVerifying}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleVerifyPassword}
                        disabled={isVerifying || !password}
                        className="flex-1"
                      >
                        {isVerifying ? "Verifying..." : "Verify Password"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <Alert className="border-green-200 bg-green-50 dark:bg-green-950/50 dark:border-green-800">
                      <div className="flex items-start space-x-3">
                        <Shield className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <AlertDescription className="text-green-800 dark:text-green-200">
                          Password verified. You can now view and export your private keys.
                        </AlertDescription>
                      </div>
                    </Alert>

                    {/* Wallet Address */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Wallet Address</Label>
                      <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                        <div className="flex-1 p-3 bg-muted rounded-md font-mono text-xs sm:text-sm break-all">
                          {wallet.address}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(wallet.address, 'Address')}
                          className="self-start sm:self-auto"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Private Key */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Private Key (Base64)</Label>
                      <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                        <div className="flex-1 p-3 bg-muted rounded-md font-mono text-xs sm:text-sm break-all">
                          {showPrivateKey ? wallet.privateKey : '•'.repeat(44)}
                        </div>
                        <div className="flex space-x-2 self-start sm:self-auto">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowPrivateKey(!showPrivateKey)}
                          >
                            {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          {showPrivateKey && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(wallet.privateKey, 'Private Key')}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Public Key */}
                    {wallet.publicKey && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Public Key (Hex)</Label>
                        <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                          <div className="flex-1 p-3 bg-muted rounded-md font-mono text-xs sm:text-sm break-all">
                            {wallet.publicKey}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(wallet.publicKey!, 'Public Key')}
                            className="self-start sm:self-auto"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Mnemonic */}
                    {wallet.mnemonic && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Mnemonic Phrase</Label>
                        <div className="p-3 bg-muted rounded-md">
                          {showMnemonic ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {wallet.mnemonic.split(' ').map((word, index) => (
                                <div key={index} className="flex items-center space-x-2">
                                  <span className="text-xs text-muted-foreground w-6">
                                    {index + 1}.
                                  </span>
                                  <span className="font-mono text-xs sm:text-sm">{word}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-4">
                              <span className="text-muted-foreground">•••••••••••••••••••••••••••••••••••••••••••••••••••</span>
                            </div>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowMnemonic(!showMnemonic)}
                            className="flex-1"
                          >
                            {showMnemonic ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                            {showMnemonic ? 'Hide' : 'Show'} Mnemonic
                          </Button>
                          {showMnemonic && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(wallet.mnemonic!, 'Mnemonic')}
                              className="flex-1"
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy Mnemonic
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    <Separator />

                    {/* Export Options */}
                    <div className="space-y-4">
                      <Label className="text-base font-medium">Export Options</Label>
                      
                      <Alert>
                        <div className="flex items-start space-x-3">
                          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <AlertDescription>
                            <strong>Security Warning:</strong> Exported files contain sensitive information. 
                            Store them securely and delete after backing up safely.
                          </AlertDescription>
                        </div>
                      </Alert>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                          variant="outline"
                          onClick={exportPrivateKey}
                          className="flex-1 h-auto p-4"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <Key className="h-5 w-5" />
                            <div className="text-center">
                              <div className="font-medium">Private Key</div>
                              <div className="text-xs text-muted-foreground">Export private key only</div>
                            </div>
                          </div>
                        </Button>

                        {wallet.mnemonic && (
                          <Button
                            variant="outline"
                            onClick={exportMnemonic}
                            className="flex-1 h-auto p-4"
                          >
                            <div className="flex flex-col items-center gap-2">
                              <FileText className="h-5 w-5" />
                              <div className="text-center">
                                <div className="font-medium">Mnemonic</div>
                                <div className="text-xs text-muted-foreground">Export mnemonic phrase</div>
                              </div>
                            </div>
                          </Button>
                        )}

                        <Button
                          variant="outline"
                          onClick={exportWalletInfo}
                          className="flex-1 h-auto p-4"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <Download className="h-5 w-5" />
                            <div className="text-center">
                              <div className="font-medium">Complete Wallet Info</div>
                              <div className="text-xs text-muted-foreground">Export all wallet information</div>
                            </div>
                          </div>
                        </Button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button variant="outline" onClick={handleClose}>
                        Close
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}