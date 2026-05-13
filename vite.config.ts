import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import fs from 'fs';

// Read version and name from manifest.json
const manifestPath = path.resolve(__dirname, 'extensionFiles/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const APP_VERSION = manifest.version;
const APP_NAME = manifest.name;
const APP_TITLE = manifest.action?.default_title || APP_NAME;

// Plugin to exclude screenshot folder from public directory copy
function excludeScreenshotPlugin(): Plugin {
  return {
    name: 'exclude-screenshot',
    writeBundle() {
      const screenshotPath = path.resolve(__dirname, 'dist/screenshot');
      if (fs.existsSync(screenshotPath)) {
        fs.rmSync(screenshotPath, { recursive: true, force: true });
        console.log('✓ Removed screenshot folder from dist');
      }
    }
  };
}

// Plugin to inject app title from manifest into HTML
function injectAppTitlePlugin(): Plugin {
  return {
    name: 'inject-app-title',
    transformIndexHtml(html) {
      return html.replace(/<title>.*<\/title>/, `<title>${APP_TITLE}</title>`);
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    excludeScreenshotPlugin(),
    injectAppTitlePlugin(),
    // Opt-in bundle audit (Rule 8). Enable with ANALYZE=1 npm run build.
    // Writes dist/bundle-stats.html + dist/bundle-stats.json.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'dist/bundle-stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            emitFile: false,
          }) as Plugin,
          visualizer({
            filename: 'dist/bundle-stats.json',
            template: 'raw-data',
            gzipSize: true,
            emitFile: false,
          }) as Plugin,
        ]
      : []),
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_NAME__: JSON.stringify(APP_NAME),
    __APP_TITLE__: JSON.stringify(APP_TITLE),
  },
  // Allow Vite to serve .wasm files from pvac_server/build-wasm
  assetsInclude: ['**/*.wasm'],
  // Web Worker configuration — must use es format for code-splitting builds
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 1500,
    copyPublicDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        popup: path.resolve(__dirname, 'src/popup.tsx'),
        expanded: path.resolve(__dirname, 'src/expanded.tsx'),
        offscreen: path.resolve(__dirname, 'offscreen.html')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // Keep WASM files without hash to avoid duplicates
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          // Keep CSS without hash so popup.html can reference it with
          // a stable filename (extension popup.html uses hardcoded path)
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks: (id) => {
          // Deduplicate PVAC modules into single chunks
          if (id.includes('lib/pvac/')) {
            if (id.includes('balance-ops')) return 'pvac-balance';
            if (id.includes('stealth-ops')) return 'pvac-stealth';
            if (id.includes('wasm-loader')) return 'pvac-wasm';
            if (id.includes('pvac-worker')) return 'pvac-worker';
            if (id.includes('node-registration')) return 'pvac-core';
            if (id.includes('crypto-utils')) return 'pvac-core';
          }
          
          if (id.includes('node_modules')) {
            // React core — must be in its own chunk and resolved first.
            // Using exact path segments to avoid matching react-* packages
            // that live in the vendor chunk and import React (which would
            // create a circular dependency and break useLayoutEffect).
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/react-is/') ||
              id.includes('/node_modules/scheduler/')
            ) return 'react-vendor';

            // React-based UI libraries that import React — keep together with
            // react-vendor to prevent vendor <-> react-vendor circular chunks.
            if (
              id.includes('/node_modules/recharts/') ||
              id.includes('/node_modules/react-day-picker/') ||
              id.includes('/node_modules/react-hook-form/') ||
              id.includes('/node_modules/react-loading-skeleton/') ||
              id.includes('/node_modules/react-resizable-panels/') ||
              id.includes('/node_modules/embla-carousel-react/') ||
              id.includes('/node_modules/vaul/') ||
              id.includes('/node_modules/cmdk/') ||
              id.includes('/node_modules/sonner/') ||
              id.includes('/node_modules/input-otp/') ||
              id.includes('/node_modules/next-themes/') ||
              id.includes('/node_modules/qrcode.react/') ||
              id.includes('/node_modules/@dnd-kit/')
            ) return 'react-vendor';

            if (id.includes('/node_modules/ethers/')) return 'ethers';
            if (id.includes('/node_modules/@radix-ui/')) return 'ui-vendor';

            // Split the big generic vendor chunk into coherent groups so a
            // single library change doesn't invalidate the whole vendor.
            //
            // bip39 owns a ~160 KB English wordlist and is only ever pulled
            // in through GenerateWallet / ImportWallet (now React.lazy'd),
            // so put it in its own chunk that the onboarding code can lazy
            // load without dragging tweetnacl/buffer off the critical path.
            if (id.includes('/node_modules/bip39/')) return 'bip39-vendor';

            if (
              id.includes('/node_modules/tweetnacl/') ||
              id.includes('/node_modules/buffer/')
            ) return 'crypto-vendor';

            if (
              id.includes('/node_modules/date-fns/') ||
              id.includes('/node_modules/zod/') ||
              id.includes('/node_modules/idb/') ||
              id.includes('/node_modules/@hookform/') ||
              id.includes('/node_modules/clsx/') ||
              id.includes('/node_modules/class-variance-authority/') ||
              id.includes('/node_modules/tailwind-merge/') ||
              id.includes('/node_modules/tailwindcss-animate/')
            ) return 'utils-vendor';

            return 'vendor';
          }
        }
      }
    }
  },
  esbuild: {
    // Don't drop console in development/debugging
    // drop: ['debugger'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://46.101.86.250:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: true,
        configure: (proxy) => {
          // Handle dynamic target based on X-RPC-URL header
          proxy.on('proxyReq', (proxyReq, req) => {
            // Get RPC URL from X-RPC-URL header
            const rpcUrl = req.headers['x-rpc-url'];
            if (rpcUrl && typeof rpcUrl === 'string') {
              try {
                const url = new URL(rpcUrl);
                
                // Update the target host for this request
                proxyReq.setHeader('host', url.host);
                
                // Log the dynamic routing
                // console.log(`Proxying request to: ${url.protocol}//${url.host}${req.url}`);
              } catch {
                console.warn('Invalid RPC URL in header:', rpcUrl);
                // Keep default host
                proxyReq.setHeader('host', '46.101.86.250');
              }
            } else {
              // Default host if no header provided
              proxyReq.setHeader('host', '46.101.86.250');
            }
          });
        }
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    cors: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
          process: true,
        }),
      ],
    },
  },
});