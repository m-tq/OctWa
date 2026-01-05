import { Lock, Unlock, Send, Users } from 'lucide-react';

interface AnimatedIconProps {
  type: 'encrypt' | 'decrypt' | 'send-public' | 'send-private' | 'multi-send';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function AnimatedIcon({ type, size = 'md' }: AnimatedIconProps) {
  const sizeClasses = {
    xs: 'w-16 h-16',
    sm: 'w-20 h-20',
    md: 'w-24 h-24',
    lg: 'w-32 h-32'
  };

  const iconSizes = {
    xs: 'h-8 w-8',
    sm: 'h-10 w-10',
    md: 'h-12 w-12',
    lg: 'h-16 w-16'
  };

  const isPrivate = type === 'decrypt' || type === 'send-private' || type === 'encrypt';

  return (
    <div className="flex justify-center mb-4">
      <div 
        className={`${sizeClasses[size]} rounded-full flex items-center justify-center relative ${
          isPrivate 
            ? 'bg-[#0000db]/10 border-2 border-[#0000db]/30' 
            : 'bg-muted/50 border-2 border-border'
        }`}
      >
        {/* Pulse ring animation */}
        <div 
          className={`absolute inset-0 rounded-full animate-ping opacity-20 ${
            isPrivate ? 'bg-[#0000db]' : 'bg-foreground'
          }`}
          style={{ animationDuration: '2s' }}
        />
        
        {/* Rotating ring */}
        <div 
          className={`absolute inset-0 rounded-full border-2 border-transparent animate-spin ${
            isPrivate ? 'border-t-[#0000db]/50' : 'border-t-foreground/30'
          }`}
          style={{ animationDuration: '3s' }}
        />

        {/* Icon */}
        <div className={`relative z-10 ${isPrivate ? 'text-[#0000db]' : 'text-foreground'}`}>
          {type === 'encrypt' && <Lock className={`${iconSizes[size]} animate-pulse`} style={{ animationDuration: '2s' }} />}
          {type === 'decrypt' && <Unlock className={`${iconSizes[size]} animate-pulse`} style={{ animationDuration: '2s' }} />}
          {(type === 'send-public' || type === 'send-private') && (
            <Send className={`${iconSizes[size]} animate-pulse`} style={{ animationDuration: '2s' }} />
          )}
          {type === 'multi-send' && (
            <Users className={`${iconSizes[size]} animate-pulse`} style={{ animationDuration: '2s' }} />
          )}
        </div>
      </div>
    </div>
  );
}
