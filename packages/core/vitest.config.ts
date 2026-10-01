import { defineConfig } from 'vitest/config';
import { reporters } from '../../vitest.shared';

export default defineConfig({
  test: {
    reporters: [...reporters('@selloeasy/core')],
  },
});
