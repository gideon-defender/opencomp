import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

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
]);
