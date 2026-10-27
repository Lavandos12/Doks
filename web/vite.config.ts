import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'node:path';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4747',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://127.0.0.1:4747',
        ws: true
      }
    }
  },
  resolve: {
    alias: {
      '@doks/shared': path.resolve(__dirname, '../shared/src/index.ts')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
