import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Globe, Shield, Lock, Sparkles, ChevronRight, X } from 'lucide-react';

interface OnboardingOverlayProps {
  onComplete: () => void;
}

const ONBOARDING_STORAGE_KEY = 'octra_onboarding_completed';

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if onboarding was already completed
    const completed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!completed) {
      setIsVisible(true);
    }
  }, []);

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    setIsVisible(false);
    onComplete();
  };

  const handleSkip = () => {
    handleComplete();
  };

  const steps = [
    {
      icon: <div className="relative">
        <Globe className="h-12 w-12 text-muted-foreground" />
        <Shield className="h-8 w-8 text-[#00E5C0] absolute -bottom-1 -right-1" />
      </div>,
      title: "Public vs Private Mode",
      description: "Switch between Public Mode (standard blockchain transactions) and Private Mode (encrypted, untraceable transfers). Your choice, your privacy.",
      highlight: "Private Mode keeps your balance and transactions hidden from observers."
    },
    {
      icon: <Lock className="h-12 w-12 text-[#00E5C0]" />,
      title: "What \"Encrypt\" Means",
      description: "When you encrypt your balance, it's processed using Fully Homomorphic Encryption (FHE). This means your funds can be computed on without ever being decrypted.",
      highlight: "Only you can see your encrypted balance. The network processes it blindly."
    },
    {
      icon: <Sparkles className="h-12 w-12 text-[#00E5C0]" />,
      title: "Why Octra is Different",
      description: "Unlike regular wallets, Octra gives you true financial privacy. No one can trace your transactions or see your balance when you're in Private Mode.",
      highlight: "Your keys, your privacy, your control."
    }
  ];

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Skip button */}
        <div className="flex justify-end mb-4">
          <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
            <X className="h-4 w-4 mr-1" />
            Skip
          </Button>
        </div>

        {/* Content */}
        <div className="bg-card border border-border p-6 space-y-6">
          {/* Progress dots */}
          <div className="flex justify-center gap-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  index === step 
                    ? 'bg-[#3A4DFF] w-6' 
                    : index < step 
                      ? 'bg-[#3A4DFF]/50' 
                      : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Step content */}
          <div className="text-center space-y-4 py-4">
            <div className="flex justify-center">
              {steps[step].icon}
            </div>
            <h2 className="text-xl font-semibold">{steps[step].title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {steps[step].description}
            </p>
            <div className="bg-[#3A4DFF]/5 border border-[#3A4DFF]/20 p-3">
              <p className="text-xs text-[#3A4DFF] font-medium">
                💡 {steps[step].highlight}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex gap-3">
            {step > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep(step - 1)}
                className="flex-1"
              >
                Back
              </Button>
            )}
            <Button
              onClick={() => {
                if (step < steps.length - 1) {
                  setStep(step + 1);
                } else {
                  handleComplete();
                }
              }}
              className="flex-1 bg-[#3A4DFF] hover:bg-[#6C63FF]/90"
            >
              {step < steps.length - 1 ? (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              ) : (
                "Get Started"
              )}
            </Button>
          </div>

          {/* Step counter */}
          <p className="text-center text-xs text-muted-foreground">
            Step {step + 1} of {steps.length}
          </p>
        </div>
      </div>
    </div>
  );
}

// Hook to check if onboarding should be shown
export function useOnboarding() {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    setShouldShow(!completed);
  }, []);

  const resetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    setShouldShow(true);
  };

  return { shouldShow, resetOnboarding };
}

// Helper to reset onboarding (for wallet reset)
export function resetOnboardingState(): void {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}
