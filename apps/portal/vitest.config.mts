import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

// No vite-tsconfig-paths on purpose: its types can clash with vitest's bundled
// vite during Next's build-time typecheck on Vercel. Aliases are mirrored by
// hand from tsconfig instead. Vite 8 / rolldown transforms JSX in .tsx source
// natively via its oxc transform when jsx.runtime is configured, which lets
// component tests import @gideon-defender/ui source without a UI package build.
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
  test: {
    // jsdom, not node: the include glob covers component tests (.jsx/.tsx) that
    // need DOM APIs (e.g. testing-library's render). Matches apps/app and
    // apps/framework-editor. Node-only tests run fine under jsdom too.
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.next'],
  },
  resolve: {
    // Mirror the tsconfig path aliases so tests can import via `@/...` and the
    // `@db`/`@db/server` prisma aliases. `@db/server` must precede `@db` so the
    // more specific alias wins. (Modules importing prisma are mocked in tests.)
    alias: {
      // Use source so component tests do not require a UI package build.
      '@gideon-defender/ui/button': resolve(
        import.meta.dirname,
        '../../packages/ui/src/components/button.tsx',
      ),
      '@db/server': resolve(import.meta.dirname, './prisma/server'),
      '@db': resolve(import.meta.dirname, './prisma'),
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
