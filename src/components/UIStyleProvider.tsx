import { useEffect, useState } from 'react';

/**
 * UI Style — orthogonal to light/dark theme.
 *
 *   default · existing Octrascan-inspired look (flat, sharp, 11px base).
 *   nova    · alternate look modeled after app.nova.markets (violet accent,
 *             Inter type, softer radii, more airy spacing).
 *
 * Implemented as a module-level singleton so it can be bootstrapped before
 * React mounts (no FOUC when the popup first paints) and still hot-updated
 * via a tiny `useUIStyle` hook. The style is applied as a `ui-<style>` class
 * on <html> so both Tailwind utilities and override rules in `nova.css` can
 * key off it.
 */

export type UIStyle = 'default' | 'nova';

const STORAGE_KEY = 'octra-ui-style';
const UI_STYLE_CLASSES: UIStyle[] = ['default', 'nova'];

function normalize(value: string | null | undefined): UIStyle {
  return value === 'nova' ? 'nova' : 'default';
}

function readStoredStyle(): UIStyle {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'default';
  }
}

function applyUIStyleToDocument(style: UIStyle): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  UI_STYLE_CLASSES.forEach((s) => root.classList.remove(`ui-${s}`));
  root.classList.add(`ui-${style}`);
  root.dataset.uiStyle = style;
}

type Listener = (style: UIStyle) => void;
const listeners = new Set<Listener>();
let currentStyle: UIStyle = readStoredStyle();

/**
 * Call once before React renders (e.g. in `main.tsx`) so the stored style is
 * active on the very first paint. Safe to call multiple times.
 */
export function bootstrapUIStyle(): void {
  currentStyle = readStoredStyle();
  applyUIStyleToDocument(currentStyle);
}

export function getUIStyle(): UIStyle {
  return currentStyle;
}

export function setUIStyle(style: UIStyle): void {
  const next = normalize(style);
  if (next === currentStyle) return;
  currentStyle = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode / storage quota — fall back to in-memory only */
  }
  applyUIStyleToDocument(next);
  listeners.forEach((l) => l(next));
}

// Keep open tabs in sync — popup ↔ expanded view share the same choice.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = normalize(e.newValue);
    if (next === currentStyle) return;
    currentStyle = next;
    applyUIStyleToDocument(next);
    listeners.forEach((l) => l(next));
  });
}

export function useUIStyle(): {
  uiStyle: UIStyle;
  setUIStyle: (style: UIStyle) => void;
} {
  const [style, setStyleState] = useState<UIStyle>(currentStyle);
  useEffect(() => {
    const listener: Listener = (next) => setStyleState(next);
    listeners.add(listener);
    // Sync in case module-level state changed between render and effect.
    if (currentStyle !== style) setStyleState(currentStyle);
    return () => {
      listeners.delete(listener);
    };
  }, [style]);
  return { uiStyle: style, setUIStyle };
}
