/**
 * Balance Pie Chart Component
 * Shows percentage comparison between public and encrypted balance.
 * Supports isDecrypting spinner while PVAC is fetching encrypted balance.
 */

import { useMemo } from 'react';
import { Globe, Lock, Loader2 } from 'lucide-react';

interface BalancePieChartProps {
  publicBalance: number;
  encryptedBalance: number;
  isCompact?: boolean;
  /** Show spinner on encrypted balance row while PVAC is decrypting */
  isDecrypting?: boolean;
}

export function BalancePieChart({
  publicBalance,
  encryptedBalance,
  isCompact = false,
  isDecrypting = false,
}: BalancePieChartProps) {
  const { publicPercent, encryptedPercent, total } = useMemo(() => {
    const total = publicBalance + encryptedBalance;
    if (total === 0) return { publicPercent: 0, encryptedPercent: 0, total: 0 };
    return {
      publicPercent: (publicBalance / total) * 100,
      encryptedPercent: (encryptedBalance / total) * 100,
      total,
    };
  }, [publicBalance, encryptedBalance]);

  const pieGradient = useMemo(() => {
    if (total === 0 && !isDecrypting) return 'conic-gradient(#e5e7eb 0deg 360deg)';
    const publicDeg = (publicPercent / 100) * 360;
    return `conic-gradient(
      #3A4DFF 0deg ${publicDeg}deg,
      #00E5C0 ${publicDeg}deg 360deg
    )`;
  }, [publicPercent, total, isDecrypting]);

  // Show chart if there's balance OR if we're still decrypting (cipher exists)
  if (total === 0 && !isDecrypting) return null;

  if (isCompact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
        <div
          className={`w-12 h-12 rounded-full flex-shrink-0 shadow-sm ${isDecrypting ? 'animate-pulse' : ''}`}
          style={{ background: pieGradient }}
        />
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#3A4DFF]" />
              <span className="text-muted-foreground">Public</span>
            </div>
            <span className="font-mono font-medium">{publicPercent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#00E5C0]" />
              <span className="text-muted-foreground">Encrypted</span>
            </div>
            {isDecrypting ? (
              <Loader2 className="h-3 w-3 animate-spin text-[#00E5C0]" />
            ) : (
              <span className="font-mono font-medium">{encryptedPercent.toFixed(1)}%</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gradient-to-br from-background to-muted/20">
      <div className="flex items-center gap-4">
        {/* Pie Chart */}
        <div className="relative flex-shrink-0">
          <div
            className={`w-24 h-24 rounded-full shadow-lg ${isDecrypting ? 'animate-pulse' : ''}`}
            style={{ background: pieGradient }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-background flex items-center justify-center">
              {isDecrypting ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#00E5C0]" />
              ) : (
                <span className="text-xs font-medium text-muted-foreground">Balance</span>
              )}
            </div>
          </div>
        </div>

        {/* Legend & Stats */}
        <div className="flex-1 space-y-3">
          <div className="space-y-2">
            {/* Public Balance */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#3A4DFF] shadow-sm" />
                <Globe className="h-3.5 w-3.5 text-[#3A4DFF]" />
                <span className="text-sm text-muted-foreground">Public</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{publicBalance.toFixed(4)} OCT</span>
                <span className="text-xs text-muted-foreground font-mono">({publicPercent.toFixed(1)}%)</span>
              </div>
            </div>

            {/* Encrypted Balance */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#00E5C0] shadow-sm" />
                <Lock className="h-3.5 w-3.5 text-[#00E5C0]" />
                <span className="text-sm text-muted-foreground">Encrypted</span>
              </div>
              {isDecrypting ? (
                <div className="flex items-center gap-1.5 text-[#00E5C0]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs">Decrypting...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{encryptedBalance.toFixed(4)} OCT</span>
                  <span className="text-xs text-muted-foreground font-mono">({encryptedPercent.toFixed(1)}%)</span>
                </div>
              )}
            </div>
          </div>

          {/* Total */}
          <div className="pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Balance</span>
              {isDecrypting ? (
                <span className="text-xs text-muted-foreground italic">calculating...</span>
              ) : (
                <span className="font-mono text-sm font-bold">{total.toFixed(4)} OCT</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
