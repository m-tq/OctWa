import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
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
  plugins: [react(), excludeScreenshotPlugin(), injectAppTitlePlugin()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_NAME__: JSON.stringify(APP_NAME),
    __APP_TITLE__: JSON.stringify(APP_TITLE),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 1000,
    copyPublicDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        popup: path.resolve(__dirname, 'src/popup.tsx'),
        expanded: path.resolve(__dirname, 'src/expanded.tsx')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('ethers')) {
              return 'ethers';
            }
            if (id.includes('three')) {
              return 'three';
            }
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
        target: 'https://octra.network',
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
                proxyReq.setHeader('host', 'octra.network');
              }
            } else {
              // Default host if no header provided
              proxyReq.setHeader('host', 'octra.network');
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