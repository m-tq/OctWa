import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
  isPopupMode?: boolean;
}

/** Animated logo — stroke draw + scale-in inner circle */
const AnimatedLogo = ({ size = 96 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 50 50"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="OctWa Logo"
  >
    <style>{`
      .outer-circle {
        stroke-dasharray: 132;
        stroke-dashoffset: 132;
        animation: drawOuter 0.5s ease-out forwards;
      }
      .inner-circle {
        transform-origin: center;
        transform: scale(0);
        animation: scaleIn 0.3s ease-out 0.4s forwards;
      }
      @keyframes drawOuter { to { stroke-dashoffset: 0; } }
      @keyframes scaleIn   { to { transform: scale(1); } }
    `}</style>
    <circle
      cx="25" cy="25" r="21"
      stroke="#3B567F" strokeWidth="8" fill="none"
      className="outer-circle"
    />
    <circle cx="25" cy="25" r="9" fill="#3B567F" className="inner-circle" />
  </svg>
);

export function SplashScreen({ onComplete, duration = 1500, isPopupMode = false }: SplashScreenProps) {
  const [isAnimating, setIsAnimating] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsFading(true), duration - 400);
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
      <div className="flex flex-col items-center gap-3">
        {/* Logo */}
        <div className={`flex items-center justify-center ${isPopupMode ? 'w-24 h-24' : 'w-32 h-32'}`}>
          <AnimatedLogo size={isPopupMode ? 80 : 96} />
        </div>

        {/* App name + subtitle — fade in after logo draws */}
        <div
          className="text-center opacity-0"
          style={{ animation: 'fadeInUp 0.3s ease-out 0.6s forwards' }}
        >
          <style>{`
            @keyframes fadeInUp {
              from { opacity: 0; transform: translateY(8px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          {/* 12px title — oct-type-size-03 */}
          <div
            className="font-bold text-primary"
            style={{
              fontSize: isPopupMode ? 'var(--oct-type-size-03)' : '1rem',
              letterSpacing: 'var(--oct-letter-space)',
            }}
          >
            {__APP_NAME__.split(' ')[0].toLowerCase()} | wallet
          </div>
          {/* 10px subtitle — oct-type-size-01 */}
          <div
            className="text-muted-foreground mt-0.5"
            style={{ fontSize: 'var(--oct-type-size-01)' }}
          >
            encrypted by default
          </div>
        </div>
      </div>
    </div>
  );
}
