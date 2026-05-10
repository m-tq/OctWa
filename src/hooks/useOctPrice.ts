/**
 * useOctPrice — fetches OCT/USD price from CoinGecko.
 * Refreshes every 60 seconds while the tab is visible. Pauses in the
 * background so hidden popups don't keep hammering CoinGecko. Returns null
 * while loading or on error.
 */
import { useState, useEffect, useRef } from 'react';

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=octra&vs_currencies=usd';
const REFRESH_MS = 60_000;

export function useOctPrice(): number | null {
  const [price, setPrice] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const fetchPrice = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const data = await res.json();
        const usd = data?.octra?.usd;
        if (typeof usd === 'number' && usd > 0) setPrice(usd);
      } catch {
        // silently ignore — price stays at last known value
      } finally {
        inFlightRef.current = false;
      }
    };

    const start = () => {
      if (timerRef.current !== null) return;
      fetchPrice();
      timerRef.current = setInterval(fetchPrice, REFRESH_MS);
    };

    const stop = () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      start();
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return price;
}

/** Format a USD value compactly: $0.00 / $1.23K / $1.23M */
export function formatUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}
