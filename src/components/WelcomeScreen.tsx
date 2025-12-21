import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GenerateWallet } from './GenerateWallet';
import { ImportWallet } from './ImportWallet';
import { PasswordSetup } from './PasswordSetup';
import { Plus, Download, Info } from 'lucide-react';
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
    console.log('🔑 WelcomeScreen: handlePasswordSet called with wallet:', wallet.address);
    setShowPasswordSetup(false);
    setPendingWallet(null);
    console.log('🚀 WelcomeScreen: Calling onWalletCreated...');
    onWalletCreated(wallet);
    console.log('✅ WelcomeScreen: onWalletCreated called');
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
              <img 
                src="/icons/octwa128x128.png" 
                alt="OctWa Logo" 
                className="h-10 w-10"
              />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-3 text-foreground">OctWa - Octra Wallet</h1>
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
      </div>

      {/* GitHub Link - Fixed position bottom left */}
      <a
        href="https://github.com/m-tq/OctWa"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-4 left-4 p-2 rounded-full bg-background/80 backdrop-blur-sm border border-border/40 hover:bg-accent transition-colors z-50"
        title="View on GitHub"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-foreground"
          fill="currentColor"
        >
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      </a>
    </div>
  );
}