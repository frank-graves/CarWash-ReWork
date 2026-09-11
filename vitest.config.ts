// vitest.config.ts
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
  resolve: {
    // Espejo de tsconfig.json. Vault y wordlist se testean sin navegador:
    // fake-indexeddb y el crypto de Node bastan para cubrir el ciclo completo.
    alias: {
      '@core': resolve(import.meta.dirname, './src/core'),
      '@infra': resolve(import.meta.dirname, './src/infra'),
      '@ui': resolve(import.meta.dirname, './src/ui'),
      '@styles': resolve(import.meta.dirname, './src/styles'),
    },
  },
});
