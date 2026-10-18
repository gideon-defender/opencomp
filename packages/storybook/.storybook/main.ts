import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';
import type { Alias, AliasOptions } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root: stories pull in components from apps/* and packages/*, so the
// tsconfig path resolver has to see every workspace tsconfig (e.g. the
// `@db` and `@/*` aliases declared by apps/app).
const root = path.resolve(dirname, '../../..');

/** Vite accepts object or array aliases; normalize to the array form. */
function normalizeAliases(alias: AliasOptions | undefined): Alias[] {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias;
  return Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // `public/mockServiceWorker.js` must be served at the root for MSW.
  staticDirs: ['../public'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
  typescript: {
    reactDocgen: false,
  },
  async viteFinal(config) {
    const tsconfigPaths = await import('vite-tsconfig-paths');
    const tailwind = await import('@tailwindcss/vite');
    config.plugins = config.plugins ?? [];
    config.plugins.push(
      tsconfigPaths.default({
        root,
      }),
      // packages/ui ships Tailwind v4 source CSS (`@import 'tailwindcss'`),
      // which only compiles with Tailwind's own bundler plugin.
      tailwind.default(),
    );

    // These workspace packages publish CommonJS builds whose named exports
    // Rollup can't detect statically (tsc emits `Object.defineProperty`
    // re-exports). Resolve them to TypeScript source instead.
    const sourceAliases: Record<string, string> = {
      '@gideon-defender/utils/format': '../../utils/src/format.ts',
      '@gideon-defender/utils': '../../utils/src/index.ts',
      '@gideon-defender/auth/permissions': '../../auth/src/permissions.ts',
      '@gideon-defender/auth': '../../auth/src/index.ts',
      // Next.js runtime modules need an app router/server context that does
      // not exist outside `next dev`. See src/mocks/next/*.
      'next/navigation': '../src/mocks/next/navigation.tsx',
      'next/link': '../src/mocks/next/link.tsx',
      'next/image': '../src/mocks/next/image.tsx',
      // `@db` pulls in @prisma/client, whose browser entry needs the generated
      // `.prisma/client/index-browser` bundle. Components only read enums.
      '@db': '../src/mocks/db.ts',
    };

    config.resolve = {
      ...(config.resolve ?? {}),
      alias: [
        ...normalizeAliases(config.resolve?.alias),
        ...Object.entries(sourceAliases).map(([find, target]) => ({
          find: new RegExp(`^${find.replace(/[/\\-]/g, '\\$&')}$`),
          replacement: path.resolve(dirname, target),
        })),
      ],
    };

    // Default target is too low for modern syntax in deps. The dependency
    // pre-bundler (dev mode) needs the same target as the production build.
    config.build = {
      ...(config.build ?? {}),
      target: 'es2022',
    };

    config.optimizeDeps = {
      ...(config.optimizeDeps ?? {}),
      esbuildOptions: {
        ...(config.optimizeDeps?.esbuildOptions ?? {}),
        target: 'es2022',
        // The dev dep pre-bundler is a separate esbuild pass that does not read
        // `config.esbuild`. Without this, deps shipping untransformed JSX (e.g.
        // @trycompai/design-system) compile to `React.createElement` and throw
        // `React is not defined` — but only in dev.
        jsx: 'automatic',
      },
    };

    // App code reads `process.env.*` at module scope (e.g. apps/app/src/env.mjs,
    // which t3-env evaluates on import). Storybook only shims this for the
    // production build, so dev threw `process is not defined`. Inlining a
    // literal object also covers `process.env.NODE_ENV` without relying on
    // define key ordering.
    config.define = {
      ...(config.define ?? {}),
      'process.env': JSON.stringify({
        NODE_ENV: config.mode === 'production' ? 'production' : 'development',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_PORTAL_URL: 'http://localhost:3002',
        NEXT_PUBLIC_BETTER_AUTH_URL: 'http://localhost:3001',
        NEXT_PUBLIC_APP_ENV: 'storybook',
        NEXT_PUBLIC_SELF_HOSTED: 'false',
        // Components that integrate a third-party widget bail out early when
        // their public key is missing, so a story would render nothing.
        NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER: 'storybook-novu-app',
        NEXT_PUBLIC_POSTHOG_KEY: 'storybook-posthog-key',
        NEXT_PUBLIC_POSTHOG_HOST: 'https://posthog.example.com',
      }),
    };

    // packages/ui's tsconfig sets `jsx: "preserve"` for its tsup build, which
    // makes esbuild fall back to the classic runtime (`React.createElement`)
    // when Vite compiles those sources through the tsconfig path aliases.
    config.esbuild = {
      ...(config.esbuild ?? {}),
      jsx: 'automatic',
    };

    return config;
  },
};

export default config;
