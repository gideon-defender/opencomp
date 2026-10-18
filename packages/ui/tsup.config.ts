import { defineConfig } from 'tsup';

export default defineConfig({
  // tsup expands these globs itself via tinyglobby (picomatch/fdir). We avoid
  // importing the `glob` package here: loading it during config evaluation
  // pulls in glob→minimatch→brace-expansion (ESM), whose `balanced-match`
  // resolution is fragile under hoisted installs and breaks the build on CI.
  entry: [
    'src/index.ts',
    'src/components/**/*.{ts,tsx}',
    'src/hooks/**/*.{ts,tsx}',
    'src/utils/**/*.{ts,tsx}',
  ],
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
  bundle: false,
  external: ['react', 'react-dom'],
  target: 'es2022',
  platform: 'neutral',
  esbuildOptions(options) {
    // Compile JSX so dist works for every consumer (Next.js, Vite, Storybook).
    options.jsx = 'automatic';
    options.platform = 'neutral';
    options.packages = 'external';
  },
  outDir: 'dist',
  onSuccess: async () => {
    const { cp, readdir } = await import('fs/promises');
    const { join, relative } = await import('path');

    // tsup only emits JS/d.ts. Mirror every stylesheet into dist so subpath
    // imports like `./theme.css` from a built component still resolve.
    const copyStyles = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await copyStyles(full);
        } else if (entry.name.endsWith('.css')) {
          await cp(full, join('dist', relative('src', full)));
        }
      }
    };

    await copyStyles('src');
  },
});
