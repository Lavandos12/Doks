import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'node:path';

const targetPort = process.env.DOKS_WEB_PORT || '4747';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${targetPort}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://127.0.0.1:${targetPort}`,
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
