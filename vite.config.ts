import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 1000,
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
        manualChunks: undefined
      }
    }
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
        configure: (proxy, _options) => {
          // Handle dynamic target based on X-RPC-URL header
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Get RPC URL from X-RPC-URL header
            const rpcUrl = req.headers['x-rpc-url'];
            if (rpcUrl && typeof rpcUrl === 'string') {
              try {
                const url = new URL(rpcUrl);
                
                // Update the target host for this request
                proxyReq.setHeader('host', url.host);
                
                // Log the dynamic routing
                // console.log(`Proxying request to: ${url.protocol}//${url.host}${req.url}`);
              } catch (error) {
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