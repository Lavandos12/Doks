import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/src/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000
  },
  resolve: {
    alias: {
      '@doks/shared': path.resolve(__dirname, 'shared/src/index.ts'),
      '@doks/agent': path.resolve(__dirname, 'agent/src/index.ts')
    }
  }
});
