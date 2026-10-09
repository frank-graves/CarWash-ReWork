// vitest.rules.config.ts
// Configuración separada para los tests de reglas. A diferencia del runner
// principal, no mockea firebase/firestore: habla con el emulador real que
// arranca con `pnpm exec firebase emulators:start --only firestore`.
//
// Se corre con `pnpm run test:rules`. El timeout es alto (30s) porque el
// primer test espera a que el emulador responda.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['firestore.rules.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Sin paralelismo: hay UN emulador y los tests comparten estado.
    // El clearFirestore de beforeEach ya los aísla, pero correrlos en
    // paralelo saturaría el emulador con cientos de conexiones.
    // Vitest 5 eliminó `poolOptions.singleFork`: el equivalente es
    // fileParallelism:false, que fuerza un único worker (maxWorkers=1).
    pool: 'forks',
    fileParallelism: false,
  },
});
