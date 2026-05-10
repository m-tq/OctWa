import { Lock, Unlock, Send, Users } from 'lucide-react';

interface AnimatedIconProps {
  type: 'encrypt' | 'decrypt' | 'send-public' | 'send-private' | 'multi-send';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

/**
 * Lightweight operation header icon. Pure CSS — no rotating WebGL rings,
 * no extra DOM layers. Icons get a subtle pulse to hint work is in flight.
 */
export function AnimatedIcon({ type, size = 'md' }: AnimatedIconProps) {
  const sizeClasses = {
    xs: 'w-16 h-16',
    sm: 'w-20 h-20',
    md: 'w-24 h-24',
    lg: 'w-32 h-32',
  };

  const iconSizes = {
    xs: 'h-8 w-8',
    sm: 'h-10 w-10',
    md: 'h-12 w-12',
    lg: 'h-16 w-16',
  };

  const marginClasses = {
    xs: 'mb-2',
    sm: 'mb-4',
    md: 'mb-4',
    lg: 'mb-4',
  };

  const isPrivate = type === 'send-private' || type === 'encrypt';

  return (
    <div className={`flex justify-center ${marginClasses[size]}`}>
      <div
        className={`${sizeClasses[size]} rounded-full flex items-center justify-center ${
          isPrivate
            ? 'bg-[#00E5C0]/10 border-2 border-[#00E5C0]/30 text-[#00E5C0]'
            : 'bg-muted/50 border-2 border-border text-muted-foreground'
        }`}
      >
        {type === 'encrypt' && <Lock className={`${iconSizes[size]} animate-pulse`} />}
        {type === 'decrypt' && <Unlock className={`${iconSizes[size]} animate-pulse`} />}
        {(type === 'send-public' || type === 'send-private') && (
          <Send className={`${iconSizes[size]} animate-pulse`} />
        )}
        {type === 'multi-send' && <Users className={`${iconSizes[size]} animate-pulse`} />}
      </div>
    </div>
  );
}
