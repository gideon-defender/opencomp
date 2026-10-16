import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These node:test suites run separately in the staged-deploy CI job.
    exclude: [
      ...configDefaults.exclude,
      'scripts/online-migrate.test.mjs',
      'scripts/staged-migrate.test.mjs',
      'scripts/staged-migrate.integration.test.mjs',
    ],
  },
});
