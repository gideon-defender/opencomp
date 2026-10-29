import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-utils/setup.ts'],
    server: {
      deps: {
        // pnpm's symlinked layout lets vitest load React twice — once bundled
        // (vite-transformed ESM) and once natively (externalized CJS) — which
        // surfaces as "Invalid hook call" in specs rendering real floating-ui
        // components. Inline them so vite serves a single instance. Note the
        // base-ui pattern must cover every @base-ui/* package (utils,
        // floating-ui-react, …), not just @base-ui/react.
        inline: [/^react$/, /^react-dom$/, /@base-ui\//],
      },
    },
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'prisma/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    exclude: ['node_modules', 'dist', '.next', 'e2e'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/app/(app)/*/security/penetration-tests/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test-utils/',
        '.trigger/**',
        '.next/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/*',
        '**/*.test.{ts,tsx}',
      ],
    },
  },
  resolve: {
    // pnpm's isolated layout can resolve react/react-dom to distinct paths
    // (root symlink vs .pnpm peer copy), producing two module instances and
    // "Invalid hook call" crashes. Force a single copy like npm hoisting did.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolve(import.meta.dirname, './src'),
      '@gideon-defender/billing': resolve(
        import.meta.dirname,
        '../../packages/billing/src/index.ts',
      ),
      // Workspace packages whose `exports` point at a gitignored `dist/` must be
      // aliased to their source so vitest runs without a prior build (CI does
      // not build packages). Subpaths must precede their parent so the
      // longer match wins.
      // The app only consumes the permissions surface of @gideon-defender/auth
      // (it must never run a better-auth server), so alias to permissions.ts
      // rather than index.ts — index.ts re-exports server.ts and would drag the
      // full better-auth server + adapters into every test graph.
      '@gideon-defender/auth': resolve(
        import.meta.dirname,
        '../../packages/auth/src/permissions.ts',
      ),
      '@gideon-defender/utils/devices': resolve(
        import.meta.dirname,
        '../../packages/utils/src/devices.ts',
      ),
      '@gideon-defender/utils/encryption': resolve(
        import.meta.dirname,
        '../../packages/utils/src/encryption.ts',
      ),
      '@gideon-defender/utils/envs': resolve(
        import.meta.dirname,
        '../../packages/utils/src/envs.ts',
      ),
      '@gideon-defender/utils/file': resolve(
        import.meta.dirname,
        '../../packages/utils/src/file.ts',
      ),
      '@gideon-defender/utils/fleet': resolve(
        import.meta.dirname,
        '../../packages/utils/src/fleet.ts',
      ),
      '@gideon-defender/utils/format': resolve(
        import.meta.dirname,
        '../../packages/utils/src/format.ts',
      ),
      '@gideon-defender/utils/remediation-denylist': resolve(
        import.meta.dirname,
        '../../packages/utils/src/remediation-denylist.ts',
      ),
      '@gideon-defender/utils/remediation-script': resolve(
        import.meta.dirname,
        '../../packages/utils/src/remediation-script.ts',
      ),
      '@gideon-defender/utils/s3': resolve(import.meta.dirname, '../../packages/utils/src/s3.ts'),
      '@gideon-defender/utils/vendor-logo': resolve(
        import.meta.dirname,
        '../../packages/utils/src/vendor-logo.ts',
      ),
      '@gideon-defender/utils': resolve(import.meta.dirname, '../../packages/utils/src/index.ts'),
      '@gideon-defender/db': resolve(import.meta.dirname, '../../packages/db/src/index.ts'),
      '@gideon-defender/company': resolve(
        import.meta.dirname,
        '../../packages/company/src/index.ts',
      ),
    },
  },
});
