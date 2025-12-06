// src/polyfills.ts
import { Buffer } from 'buffer';

// Expose Buffer globally
(window as any).Buffer = Buffer;