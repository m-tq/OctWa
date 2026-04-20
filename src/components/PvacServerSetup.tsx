import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Server, CheckCircle, XCircle, Loader2, ChevronRight, X, AlertTriangle } from 'lucide-react';
import { pvacServerService } from '@/services/pvacServerService';
import { logger } from '@/utils/logger';

interface PvacServerSetupProps {
  onComplete: () => void;
}

const PVAC_SETUP_STORAGE_KEY = 'octra_pvac_setup_completed';

export function PvacServerSetup({ onComplete }: PvacServerSetupProps) {
  const [step, setStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [name, setName] = useState('Local PVAC Server');
  const [url, setUrl] = useState('http://localhost:8765');
  const [authToken, setAuthToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const completed = localStorage.getItem(PVAC_SETUP_STORAGE_KEY);
    if (!completed) {
      setIsVisible(true);
    }
  }, []);

  const handleComplete = () => {
    localStorage.setItem(PVAC_SETUP_STORAGE_KEY, 'true');
    setIsVisible(false);
    onComplete();
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleValidate = async () => {
    if (!url.trim()) {
      setValidationResult({
        success: false,
        message: 'Please enter PVAC server URL'
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
      const result = await pvacServerService.testConnection(url.trim(), authToken.trim());

      if (result.success) {
        setValidationResult({
          success: true,
          message: `Connected successfully! Server version: ${result.version || 'unknown'}`
        });
        
        // Save server
        pvacServerService.addServer({
          name: name.trim() || 'Local PVAC Server',
          url: url.trim(),
          authToken: authToken.trim()
        });
        
        logger.info('PVAC server configured successfully');
        
        // Auto-complete after 1.5 seconds
        setTimeout(() => {
          handleComplete();
        }, 1500);
      } else {
        setValidationResult({
          success: false,
          message: result.message
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

  const steps = [
    {
      icon: <Server className="h-12 w-12 text-[#00E5C0]" />,
      title: "PVAC Server Setup",
      description: "PVAC (Publicly Verifiable Arithmetic Computations) server accelerates encrypted operations. Set up your server URL and authentication token.",
      content: (
        <div className="space-y-3">
          <div className="bg-muted/50 border border-border p-3 rounded-md">
            <p className="text-xs text-muted-foreground mb-2">
              Need help setting up your PVAC server?
            </p>
            <a
              href="https://github.com/m-tq/pvac_server"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#00E5C0] hover:text-[#00E5C0]/80 transition-colors"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              View Full Instructions on GitHub
            </a>
          </div>
        </div>
      )
    },
    {
      icon: <Server className="h-12 w-12 text-[#00E5C0]" />,
      title: "Configure Server",
      description: "Enter your PVAC server details. Auth token is required for secure communication.",
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pvac-name">Server Name</Label>
            <Input
              id="pvac-name"
              type="text"
              placeholder="Local PVAC Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isValidating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pvac-url">Server URL *</Label>
            <Input
              id="pvac-url"
              type="text"
              placeholder="http://localhost:8765"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isValidating}
            />
            <p className="text-xs text-muted-foreground">
              Default: http://localhost:8765
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pvac-token">Auth Token *</Label>
            <Input
              id="pvac-token"
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

          <Button
            onClick={handleValidate}
            disabled={isValidating || !url.trim() || !authToken.trim()}
            className="w-full bg-[#00E5C0] hover:bg-[#00E5C0]/90 text-black"
          >
            {isValidating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing Connection...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Test & Save
              </>
            )}
          </Button>
        </div>
      )
    }
  ];

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-4">
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
            <X className="h-4 w-4 mr-1" />
            Skip (Configure Later)
          </Button>
        </div>

        <div className="bg-card border border-border p-6 space-y-6">
          <div className="flex justify-center gap-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  index === step 
                    ? 'bg-[#00E5C0] w-6' 
                    : index < step 
                      ? 'bg-[#00E5C0]/50' 
                      : 'bg-muted'
                }`}
              />
            ))}
          </div>

          <div className="space-y-4 py-4">
            <div className="flex justify-center">
              {steps[step].icon}
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">{steps[step].title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {steps[step].description}
              </p>
            </div>

            {steps[step].content && (
              <div className="pt-2">
                {steps[step].content}
              </div>
            )}

            {step === 0 && (
              <div className="bg-[#00E5C0]/5 border border-[#00E5C0]/20 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-[#00E5C0] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-[#00E5C0]">
                    PVAC server is optional but recommended for faster encrypted operations. You can always configure it later in settings.
                  </p>
                </div>
              </div>
            )}
          </div>

          {step === 0 && (
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleSkip}
                className="flex-1"
              >
                Skip for Now
              </Button>
              <Button
                onClick={() => setStep(1)}
                className="flex-1 bg-[#00E5C0] hover:bg-[#00E5C0]/90 text-black"
              >
                Configure
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(0)}
                className="flex-1"
                disabled={isValidating}
              >
                Back
              </Button>
              <Button
                onClick={handleSkip}
                variant="ghost"
                className="flex-1"
                disabled={isValidating}
              >
                Skip
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Step {step + 1} of {steps.length}
          </p>
        </div>
      </div>
    </div>
  );
}

export function usePvacSetup() {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(PVAC_SETUP_STORAGE_KEY);
    setShouldShow(!completed);
  }, []);

  const resetSetup = () => {
    localStorage.removeItem(PVAC_SETUP_STORAGE_KEY);
    setShouldShow(true);
  };

  return { shouldShow, resetSetup };
}

export function resetPvacSetupState(): void {
  localStorage.removeItem(PVAC_SETUP_STORAGE_KEY);
}
