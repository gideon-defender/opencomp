import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      // eslint-plugin-react detects the React version via
      // context.getFilename(), which ESLint 10 removed. Pin the version
      // to skip detection (all apps run React 19).
      react: { version: '19.2' },
    },
  },
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/.turbo/**',
    '**/out/**',
  ]),
  {
    rules: {
      // This repo has existing violations; keep lint actionable while we migrate.
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
      'prefer-const': 'off',
      // Data fetching in effects throughout; the compiler-derived rule wants
      // subscriptions instead. Off until migrated.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
