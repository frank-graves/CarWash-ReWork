// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// Los mismos alias que `compilerOptions.paths` de tsconfig.json, en los dos sitios
// a propósito: tsc lee tsconfig, y Vite —que además resuelve los `@import` de CSS
// de los layouts— lee esto. Cuatro líneas duplicadas cuestan menos que un theming
// roto en silencio después de cambiar un preset.
const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@infra': fileURLToPath(new URL('./src/infra', import.meta.url)),
  '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
  '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
};

// https://astro.build/config
export default defineConfig({
  vite: { resolve: { alias } },
  // La toolbar de desarrollo es un iframe con su propio servidor y su propio
  // bundle. No la necesitamos para nada de lo que hacemos aquí.
  devToolbar: { enabled: false },
});
