import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GenerateWallet } from './GenerateWallet';
import { ImportWallet } from './ImportWallet';
import { PasswordSetup } from './PasswordSetup';
import { Wallet as WalletIcon, Plus, Download, Info } from 'lucide-react';
import { Wallet } from '../types/wallet';

interface WelcomeScreenProps {
  onWalletCreated: (wallet: Wallet) => void;
}

export function WelcomeScreen({ onWalletCreated }: WelcomeScreenProps) {
  const [activeTab, setActiveTab] = useState<string>('generate');
  const [pendingWallet, setPendingWallet] = useState<Wallet | null>(null);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  
  // Check if there are existing wallets
  const hasExistingWallets = () => {
    const storedWallets = localStorage.getItem('wallets');
    return storedWallets && JSON.parse(storedWallets).length > 0;
  };

  const handleWalletGenerated = (wallet: Wallet) => {
    setPendingWallet(wallet);
    setShowPasswordSetup(true);
  };

  const handlePasswordSet = (wallet: Wallet) => {
    setShowPasswordSetup(false);
    setPendingWallet(null);
    onWalletCreated(wallet);
  };

  const handleBackToWalletCreation = () => {
    setShowPasswordSetup(false);
    setPendingWallet(null);
  };

  if (showPasswordSetup && pendingWallet) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PasswordSetup
          wallet={pendingWallet}
          onPasswordSet={handlePasswordSet}
          onBack={handleBackToWalletCreation}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8 octra-fade-in">
          <div className="flex items-center justify-center mb-6">
            <div className="p-4 bg-primary/10 rounded-full border border-primary/20">
              <WalletIcon className="h-10 w-10 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-3 text-foreground">Octra Wallet</h1>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Your secure gateway to the Octra blockchain network
          </p>
          {hasExistingWallets() && (
            <Alert className="max-w-md mx-auto mb-6 border-primary/20 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-muted-foreground">
                You have existing wallets. Creating or importing a new wallet will add it to your collection.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Main Card */}
        <Card className="shadow-sm border-border/40 bg-card/50 backdrop-blur-sm octra-fade-in">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-semibold text-foreground">
              {hasExistingWallets() ? 'Add Another Wallet' : 'Get Started'}
            </CardTitle>
            <p className="text-muted-foreground mt-2">
              {hasExistingWallets() 
                ? 'Create a new wallet or import an existing one to add to your collection'
                : 'Create a new wallet or import an existing one to begin'
              }
            </p>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8 bg-muted/50">
                <TabsTrigger value="generate" className="flex items-center gap-2 data-[state=active]:bg-background">
                  <Plus className="h-4 w-4" />
                  Create New Wallet
                </TabsTrigger>
                <TabsTrigger value="import" className="flex items-center gap-2 data-[state=active]:bg-background">
                  <Download className="h-4 w-4" />
                  Import Wallet
                </TabsTrigger>
              </TabsList>

              <TabsContent value="generate" className="space-y-4">
                <div className="text-center mb-6">
                  <h3 className="text-lg font-semibold mb-2 text-foreground">Create New Wallet</h3>
                  <p className="text-sm text-muted-foreground">
                    Generate a brand new wallet with a secure mnemonic phrase
                  </p>
                </div>
                <GenerateWallet onWalletGenerated={handleWalletGenerated} />
              </TabsContent>

              <TabsContent value="import" className="space-y-4">
                <div className="text-center mb-6">
                  <h3 className="text-lg font-semibold mb-2 text-foreground">Import Existing Wallet</h3>
                  <p className="text-sm text-muted-foreground">
                    Restore your wallet using a private key or mnemonic phrase
                  </p>
                </div>
                <ImportWallet onWalletImported={handleWalletGenerated} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-muted-foreground space-y-2">
          <p>
            By using Octra Wallet, you agree to our terms of service and privacy policy.
          </p>
          <p>
            Always keep your private keys and mnemonic phrase secure and never share them with anyone.
          </p>
        </div>
      </div>
    </div>
  );
}