import { ReactNode, useEffect, useState } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
  variant?: 'fade' | 'slide-up' | 'slide-left' | 'slide-right' | 'scale' | 'fade-slide';
  duration?: number;
  delay?: number;
}

export function PageTransition({
  children,
  className = '',
  variant = 'fade-slide',
  duration = 300,
  delay = 0,
}: PageTransitionProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  const getVariantClasses = () => {
    const baseClasses = 'transition-all ease-out';
    
    switch (variant) {
      case 'fade':
        return `${baseClasses} ${isVisible ? 'opacity-100' : 'opacity-0'}`;
      case 'slide-up':
        return `${baseClasses} ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`;
      case 'slide-left':
        return `${baseClasses} ${
          isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
        }`;
      case 'slide-right':
        return `${baseClasses} ${
          isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        }`;
      case 'scale':
        return `${baseClasses} ${
          isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`;
      case 'fade-slide':
      default:
        return `${baseClasses} ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`;
    }
  };

  return (
    <div
      className={`${getVariantClasses()} ${className}`}
      style={{ transitionDuration: `${duration}ms` }}
    >
      {children}
    </div>
  );
}

// Animated container for staggered children
interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}

export function StaggerContainer({
  children,
  className = '',
  staggerDelay = 50,
}: StaggerContainerProps) {
  return (
    <div className={className}>
      {Array.isArray(children)
        ? children.map((child, index) => (
            <PageTransition key={index} delay={index * staggerDelay} variant="fade-slide">
              {child}
            </PageTransition>
          ))
        : children}
    </div>
  );
}
