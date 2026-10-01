import { defineConfig } from 'vitest/config';
import { reporters } from '../../vitest.shared';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One shared seeded database → run files sequentially for deterministic state.
    fileParallelism: false,
    reporters: [...reporters('@selloeasy/api')],
  },
});
