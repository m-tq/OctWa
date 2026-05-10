/**
 * Minimum-duration loading helpers.
 *
 * When an async operation completes faster than the eye can notice, the
 * spinner flashes and the user wonders whether the button actually did
 * anything. These helpers keep a loading indicator visible for at least a
 * short floor (default 400 ms) so feedback always reads as "we worked on it".
 *
 * Usage:
 *
 *     const done = startMinDuration(400);
 *     setIsRefreshing(true);
 *     try {
 *       await fetchWhatever();
 *     } finally {
 *       await done();              // waits out the remainder, if any
 *       setIsRefreshing(false);
 *     }
 *
 * Or the one-shot helper:
 *
 *     await withMinDuration(fetchWhatever(), 400);
 */

export const DEFAULT_MIN_LOADING_MS = 400;

/**
 * Start tracking elapsed time and return a `done` function. Calling `done()`
 * resolves after at least `minMs` has passed since the start, otherwise
 * resolves immediately.
 */
export function startMinDuration(minMs: number = DEFAULT_MIN_LOADING_MS): () => Promise<void> {
  const start = Date.now();
  return () => {
    const remaining = minMs - (Date.now() - start);
    return remaining > 0
      ? new Promise((resolve) => setTimeout(resolve, remaining))
      : Promise.resolve();
  };
}

/**
 * Wrap a promise so it resolves no sooner than `minMs` after it was created.
 * Errors still reject immediately — we don't want to hide failures behind
 * a cosmetic delay. Rejection happens after the floor only when the input
 * promise itself rejects *before* the floor elapses; in that case the
 * rejection is delayed so the spinner gets its minimum visible window.
 */
export async function withMinDuration<T>(
  promise: Promise<T>,
  minMs: number = DEFAULT_MIN_LOADING_MS,
): Promise<T> {
  const done = startMinDuration(minMs);
  try {
    const value = await promise;
    await done();
    return value;
  } catch (err) {
    await done();
    throw err;
  }
}


// React-friendly floor for boolean loading flags.
//
// Use when a prop-driven `isLoading` boolean can flip back to `false` faster
// than a spinner/skeleton is comfortable to show. Returns a `holding` boolean
// that stays `true` for at least `minMs` after the first time `source` turned
// on in this hook's lifetime.
import { useEffect, useRef, useState } from 'react';

export function useMinDurationFlag(source: boolean, minMs: number = DEFAULT_MIN_LOADING_MS): boolean {
  const [holding, setHolding] = useState(source);
  const startedAt = useRef<number | null>(null);
  const timerId = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (source) {
      if (startedAt.current === null) startedAt.current = Date.now();
      if (timerId.current !== null) {
        clearTimeout(timerId.current);
        timerId.current = null;
      }
      setHolding(true);
      return;
    }

    const elapsed = startedAt.current !== null ? Date.now() - startedAt.current : minMs;
    const remaining = Math.max(0, minMs - elapsed);
    if (remaining === 0) {
      setHolding(false);
      startedAt.current = null;
      return;
    }

    timerId.current = setTimeout(() => {
      setHolding(false);
      startedAt.current = null;
      timerId.current = null;
    }, remaining);

    return () => {
      if (timerId.current !== null) {
        clearTimeout(timerId.current);
        timerId.current = null;
      }
    };
  }, [source, minMs]);

  return holding;
}
