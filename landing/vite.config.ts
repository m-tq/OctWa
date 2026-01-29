import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react()],
  base: './',
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three')) {
              return 'three';
            }
            if (id.includes('react-dom')) {
              return 'react-dom';
            }
            if (id.includes('react')) {
              return 'react';
            }
            return 'vendor';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
