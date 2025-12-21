import { OperationMode } from '../utils/modeStorage';

interface ModeIndicatorProps {
  mode: OperationMode;
  className?: string;
}

export function ModeIndicator({ mode }: ModeIndicatorProps) {
  // Only show badge for private mode
  if (mode !== 'private') {
    return null;
  }

  return (
    <div className="fixed bottom-[32px] right-0 z-40 pointer-events-none">
      {/* Triangle Corner Badge - Private Mode Only */}
      <div className="relative overflow-hidden transition-all duration-300">
        {/* Triangle Shape using clip-path */}
        <div
          className="w-24 h-24 bg-gradient-to-br from-[#0000db] to-[#0000aa]"
          style={{
            clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
            boxShadow: '-4px -4px 12px rgba(0, 0, 219, 0.3)',
          }}
        />

        {/* Text - positioned diagonally at center of triangle */}
        <div
          className="absolute text-white"
          style={{
            bottom: '24px',
            right: '14px',
            transform: 'rotate(-45deg)',
          }}
        >
          <span className="text-[9px] font-bold tracking-wide uppercase">
            Private
          </span>
        </div>

        {/* Subtle shine effect */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
            background:
              'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.4) 50%, transparent 60%)',
          }}
        />
      </div>
    </div>
  );
}
