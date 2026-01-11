import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
  isPopupMode?: boolean;
}

const AnimatedLogo = ({ size = 112 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 50 50"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <style>
      {`
        .outer-circle {
          stroke-dasharray: 132;
          stroke-dashoffset: 132;
          animation: drawOuter 1s ease-out forwards;
        }
        .inner-circle {
          transform-origin: center;
          transform: scale(0);
          animation: scaleIn 0.5s ease-out 0.8s forwards;
        }
        @keyframes drawOuter {
          to {
            stroke-dashoffset: 0;
          }
        }
        @keyframes scaleIn {
          to {
            transform: scale(1);
          }
        }
      `}
    </style>
    <circle
      cx="25"
      cy="25"
      r="21"
      stroke="#0000FF"
      strokeWidth="8"
      fill="none"
      className="outer-circle"
    />
    <circle cx="25" cy="25" r="9" fill="#0000FF" className="inner-circle" />
  </svg>
);

export function SplashScreen({
  onComplete,
  duration = 3000,
  isPopupMode = false,
}: SplashScreenProps) {
  const [isAnimating, setIsAnimating] = useState(true);
  const [isFading, setIsFading] = useState(false);

  console.log('🎨 SplashScreen isPopupMode:', isPopupMode);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, duration - 400);

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
      <div className="flex flex-col items-center pb-0 mb-2">
        <div className={`flex items-center justify-center ${isPopupMode ? 'w-32 h-32' : 'w-48 h-48'}`}>
          <AnimatedLogo size={isPopupMode ? 112 : 130} />
        </div>

        <div
          className="text-center opacity-0"
          style={{
            animation: 'fadeInUp 0.5s ease-out 1.3s forwards',
          }}
        >
          <style>
            {`
              @keyframes fadeInUp {
                from {
                  opacity: 0;
                  transform: translateY(10px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}
          </style>
          <h1 
            className="font-bold" 
            style={{ 
              color: '#0000db',
              fontSize: isPopupMode ? '1.75rem' : '2.5rem'
            }}
          >
            {__APP_NAME__.split(' ')[0]}
          </h1>
          <p 
            className="text-muted-foreground font-medium"
            style={{ fontSize: isPopupMode ? '0.875rem' : '1rem' }}
          >
            Encrypted by Default
          </p>
          <p 
            className="text-muted-foreground/60 mt-1"
            style={{ fontSize: isPopupMode ? '0.65rem' : '0.75rem' }}
          >
            Powered by Octra HFHE
          </p>
        </div>
      </div>
    </div>
  );
}
