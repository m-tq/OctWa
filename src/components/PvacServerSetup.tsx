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
      content: null
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
