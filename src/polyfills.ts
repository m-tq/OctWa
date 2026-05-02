// Polyfill: expose Buffer globally for libraries that expect it in the browser.
import { Buffer } from 'buffer';

(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;