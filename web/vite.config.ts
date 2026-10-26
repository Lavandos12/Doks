import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'node:path';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173
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
