import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeIdentifier, jsPropertyKey, jsString } from './lib/emit';
import { pickComponentExport, readModuleExports } from './lib/exports';
import {
  extractRouteParams,
  scanFiles,
  toPascalCase,
  toRelativeSpecifier,
} from './lib/scan';
import { isServerOnly } from './lib/server-only';
import { createPropsAnalyzer, type PropsAnalyzer } from './lib/props';
import { SKIPPED_APP_COMPONENTS } from './lib/skip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, '../src/stories');

interface Candidate {
  file: string;
  tier: 1 | 2;
  importSource: string;
  expectedName: string;
}

interface GeneratedStory {
  storyPath: string;
  content: string;
}

/**
 * Components that read from a context their parent normally provides. Values
 * are exported decorator names from src/mocks/decorators.tsx.
 */
const PROVIDER_DECORATORS: Record<string, string> = {
  Toast: 'withToast',
  ToastAction: 'withToast',
  ToastClose: 'withToast',
  ToastDescription: 'withToast',
  ToastTitle: 'withToast',
  ResizableHandle: 'withPanelGroup',
  ResizablePanel: 'withPanelGroup',
  SidebarCollapseButton: 'withSidebar',
  SignOut: 'withDropdownMenu',
  DataTableHeader: 'withTable',
  SelectUser: 'withSelect',
  // Renders only once a toast is queued.
  Toaster: 'withSonnerToast',
  // Absolutely-positioned gradient with no intrinsic size.
  Fade: 'withCanvas',
};

/**
 * `@gideon-defender/ui` only exposes components through explicit subpath
 * exports, and each subpath mirrors a file under `src/components`. Walk the
 * export map so stories import the published specifier for the source file
 * they document.
 */
async function collectUiCandidates(): Promise<Candidate[]> {
  const uiRoot = path.join(root, 'packages/ui');
  const uiPkg = JSON.parse(await fs.readFile(path.join(uiRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, string | { import?: string }>;
  };

  const candidates: Candidate[] = [];
  for (const [subpath, target] of Object.entries(uiPkg.exports)) {
    const entry = typeof target === 'string' ? target : target.import;
    if (!entry) continue;
    const match = /^\.\/dist\/components\/(.+)\.js$/.exec(entry);
    if (!match) continue;

    const sourceFile = path.join(uiRoot, 'src/components', `${match[1]}.tsx`);
    if (!(await fileExists(sourceFile))) continue;

    candidates.push({
      file: sourceFile,
      tier: 1,
      importSource: `@gideon-defender/ui${subpath.slice(1)}`,
      expectedName: componentNameFor(sourceFile),
    });
  }

  return candidates;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** `foo/index.tsx` is named after its directory, everything else after the file. */
function componentNameFor(file: string): string {
  const baseName = path.basename(file, '.tsx');
  return toPascalCase(baseName === 'index' ? path.basename(path.dirname(file)) : baseName);
}

async function collectAppCandidates(): Promise<Candidate[]> {
  const files = await scanFiles({
    dir: path.join(root, 'apps/app/src/components'),
    pattern: /\.tsx$/,
  });

  const appSrc = path.join(root, 'apps/app/src');
  const storyDir = path.join(outDir, 'tier2');
  const candidates: Candidate[] = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (SKIPPED_APP_COMPONENTS.has(relative)) continue;
    if (isServerOnly({ file, appSrc })) continue;
    candidates.push({
      file,
      tier: 2,
      importSource: toRelativeSpecifier({ from: storyDir, to: file }),
      expectedName: componentNameFor(file),
    });
  }
  return candidates;
}

function buildStory({
  componentName,
  isDefault,
  importSource,
  tier,
  params,
  urlState,
  mobileOnly,
  args,
}: {
  componentName: string;
  isDefault: boolean;
  importSource: string;
  tier: 1 | 2;
  params: string[];
  urlState: Record<string, string>;
  mobileOnly: boolean;
  args: string | null;
}): string {
  const importClause = isDefault ? componentName : `{ ${componentName} }`;

  const decorators: string[] = [];
  const decoratorImports = new Set<string>();

  const provider = PROVIDER_DECORATORS[componentName];
  if (provider) {
    decorators.push(provider);
    decoratorImports.add(provider);
  }

  if (params.length > 0) {
    decorators.push(
      `withRouteParams({ ${params
        .map((param) => `${jsPropertyKey(param)}: 'demo_value'`)
        .join(', ')} })`,
    );
    decoratorImports.add('withRouteParams');
  }

  const mocksPath = '../../mocks/decorators';
  const decoratorImportLine = decoratorImports.size
    ? `import { ${[...decoratorImports].sort().join(', ')} } from '${mocksPath}';\n`
    : '';
  const decoratorBlock = decorators.length
    ? `\n  decorators: [${decorators.join(', ')}],`
    : '';
  const parameterEntries: string[] = [];
  const urlEntries = Object.entries(urlState);
  if (urlEntries.length > 0) {
    const pairs = urlEntries
      .map(([key, value]) => `${jsPropertyKey(key)}: ${jsString(value)}`)
      .join(', ');
    parameterEntries.push(`    searchParams: { ${pairs} },`);
  }
  if (mobileOnly) {
    parameterEntries.push(`    viewport: { defaultViewport: 'mobile1' },`);
  }
  const parametersBlock = parameterEntries.length
    ? `\n  parameters: {\n${parameterEntries.join('\n')}\n  },`
    : '';

  return `import type { Meta, StoryObj } from '@storybook/react';
${decoratorImportLine}import ${importClause} from ${jsString(importSource)};

const meta = {
  title: ${jsString(`Tier ${tier} — ${componentName}`)},
  component: ${componentName},${decoratorBlock}${parametersBlock}
} satisfies Meta<typeof ${componentName}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = ${args ? `{\n  args: ${args},\n}` : '{}'};
`;
}

async function generate({
  candidates,
  analyzers,
}: {
  candidates: Candidate[];
  analyzers: Record<1 | 2, PropsAnalyzer>;
}): Promise<{
  stories: GeneratedStory[];
  skipped: string[];
}> {
  const stories: GeneratedStory[] = [];
  const skipped: string[] = [];
  const usedTitles = new Set<string>();

  for (const { file, tier, importSource, expectedName } of candidates) {
    const source = await fs.readFile(file, 'utf8');
    const moduleExports = readModuleExports(source, file);
    const picked = pickComponentExport({
      exports: moduleExports,
      expectedName,
    });

    if (!picked) {
      skipped.push(`${path.relative(root, file)} (no renderable export)`);
      continue;
    }

    const componentName = picked.name;
    // The name becomes an import binding and a file name, neither of which can
    // be quoted or escaped.
    if (!isSafeIdentifier(componentName)) {
      skipped.push(`${path.relative(root, file)} (export name is not an identifier)`);
      continue;
    }
    // React Server Components only resolve on the server; rendering one in the
    // browser throws "is an async Client Component".
    if (moduleExports.asyncNames.has(componentName)) {
      skipped.push(`${path.relative(root, file)} (async server component)`);
      continue;
    }
    // Side-effect-only components (analytics pings, global hotkey listeners)
    // render null, so a story would show a blank canvas.
    if (moduleExports.emptyRenderNames.has(componentName)) {
      skipped.push(`${path.relative(root, file)} (renders nothing)`);
      continue;
    }
    const titleKey = `${tier}:${componentName}`;
    if (usedTitles.has(titleKey)) {
      skipped.push(`${path.relative(root, file)} (duplicate of ${componentName})`);
      continue;
    }
    const args = analyzers[tier].getArgs({
      file,
      exportName: componentName,
      isDefault: picked.isDefault,
    });
    if (args.error) {
      skipped.push(`${path.relative(root, file)} (${args.error})`);
      continue;
    }
    usedTitles.add(titleKey);

    stories.push({
      storyPath: path.join(outDir, `tier${tier}`, `${componentName}.stories.tsx`),
      content: buildStory({
        componentName,
        isDefault: picked.isDefault,
        importSource,
        tier,
        params: extractRouteParams(file),
        urlState: moduleExports.urlState,
        mobileOnly: moduleExports.mobileOnly,
        args: args.code,
      }),
    });
  }

  return { stories, skipped };
}

async function resetTierDirs(): Promise<void> {
  for (const tier of [1, 2]) {
    const dir = path.join(outDir, `tier${tier}`);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  }
}

async function main(): Promise<void> {
  const candidates = [...(await collectUiCandidates()), ...(await collectAppCandidates())];
  console.log(`Scanned ${candidates.length} component files.`);

  const analyzers = {
    1: createPropsAnalyzer({ tsconfigPath: path.join(root, 'packages/ui/tsconfig.json') }),
    2: createPropsAnalyzer({ tsconfigPath: path.join(root, 'apps/app/tsconfig.json') }),
  } as const;

  const { stories, skipped } = await generate({ candidates, analyzers });

  await resetTierDirs();
  for (const story of stories) {
    await fs.writeFile(story.storyPath, story.content, 'utf8');
  }

  console.log(`Generated ${stories.length} stories.`);
  console.log(`Skipped ${skipped.length} files.`);
  for (const entry of skipped) console.log(`  - ${entry}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
