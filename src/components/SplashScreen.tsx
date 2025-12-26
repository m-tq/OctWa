import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
}

export function SplashScreen({
  onComplete,
  duration = 1500,
}: SplashScreenProps) {
  const [isAnimating, setIsAnimating] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // Start fade out before completing
    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, duration - 400);

    // Complete after duration
    const completeTimer = setTimeout(() => {
      setIsAnimating(false);
      onComplete();
    }, duration);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  if (!isAnimating) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-400 overflow-hidden ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center space-y-6">
        {/* Animated Logo with Circles */}
        <div className="relative">
          {/* Outer rotating circle */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-32 h-32 rounded-full border-4 border-transparent animate-spin"
              style={{
                borderTopColor: '#0000db',
                borderRightColor: '#0000db',
                animationDuration: '1.5s',
              }}
            />
          </div>

          {/* Middle pulsing circle */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-24 h-24 rounded-full animate-pulse"
              style={{
                backgroundColor: 'rgba(0, 0, 219, 0.1)',
                animationDuration: '1s',
              }}
            />
          </div>

          {/* Inner circle with logo */}
          <div className="relative w-32 h-32 flex items-center justify-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center animate-bounce-subtle"
              style={{ backgroundColor: '#0000db' }}
            >
              <img
                src="/icons/octwa48x48.png"
                alt="OctWa"
                className="w-12 h-12 object-contain"
              />
            </div>
          </div>

          {/* Ripple effects */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-20 h-20 rounded-full animate-ripple"
              style={{ borderColor: '#0000db' }}
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-20 h-20 rounded-full animate-ripple-delayed"
              style={{ borderColor: '#0000db' }}
            />
          </div>
        </div>

        {/* App Name */}
        <div className="text-center animate-fade-in-up">
          <h1 className="text-2xl font-bold" style={{ color: '#0000db' }}>
            OctWa
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay Encrypted</p>
        </div>
      </div>
    </div>
  );
}
