import path from 'node:path';
import ts from 'typescript';
import { jsPropertyKey } from './emit';
import { createSynthContext, ELEMENT_CONTENT, synthesizeValue, TEXT_CONTENT } from './synthesize';

export interface ArgsResult {
  code: string | null;
  error?: string;
}

export interface PropsAnalyzer {
  getArgs(input: { file: string; exportName: string; isDefault: boolean }): ArgsResult;
}

/**
 * Optional props are filled in too — a gallery should show a component's full
 * surface, and components whose props are *all* optional (`AssignedUser`,
 * `ChatUser`) otherwise render an empty box. Styling and escape-hatch props are
 * excluded: they carry no demo value and a synthetic `className` would fight
 * the component's own layout.
 */
const OPTIONAL_EXCLUDED = new Set([
  'className',
  'class',
  'style',
  'ref',
  'key',
  'asChild',
  'id',
  'slot',
  'dir',
  'tabIndex',
  'form',
]);

/**
 * Props a component only has because its props type extends a library's own
 * (React's DOM attributes, framer-motion's `motion.div`, react-number-format's
 * options). They are not part of the component's API, carry no demo value, and
 * some actively break rendering — `popover=""` hides the element until shown,
 * and an `allowedElements` filter list of nonsense strips all markdown output.
 *
 * A component's real props are declared in repository source, so anything
 * declared inside a package is treated as inherited.
 */
function isInheritedLibraryProp(property: ts.Symbol): boolean {
  const declaration = property.getDeclarations()?.[0];
  // Properties produced by a mapped type such as `Omit<ComponentProps<…>, 'x'>`
  // carry no declaration node. Only inherited props reach a component that way.
  if (!declaration) return true;
  return declaration.getSourceFile().fileName.includes('/node_modules/');
}

/**
 * Whether an optional prop's type is one the synthesizer reproduces faithfully.
 * A required prop must be synthesized or the story is skipped, but an optional
 * one can simply be left out — and guessing at a `Blob`, a ref callback or a
 * `date-fns` locale produces a value that does not typecheck. Only primitives,
 * literal unions, dates, React nodes and collections of those are accepted.
 */
function isSimpleType({
  checker,
  type,
  depth = 0,
}: {
  checker: ts.TypeChecker;
  type: ts.Type;
  depth?: number;
}): boolean {
  if (depth > 2) return false;
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false;

  const simpleFlags =
    ts.TypeFlags.String |
    ts.TypeFlags.Number |
    ts.TypeFlags.Boolean |
    ts.TypeFlags.BooleanLiteral |
    ts.TypeFlags.StringLiteral |
    ts.TypeFlags.NumberLiteral |
    ts.TypeFlags.EnumLike |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined;
  if (type.flags & simpleFlags) return true;

  if (type.isUnion()) {
    return type.types.every((member) => isSimpleType({ checker, type: member, depth }));
  }

  const name = type.getSymbol()?.getName();
  if (name === 'Date') return true;
  if (name && /^(ReactNode|ReactElement|Element|JSX\.Element)$/.test(name)) return true;

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker
      .getTypeArguments(type as ts.TypeReference)
      .every((argument) => isSimpleType({ checker, type: argument, depth: depth + 1 }));
  }

  return false;
}

/** HTML elements that cannot have children; giving them any throws at runtime. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements that reject children: void elements plus <textarea>, which needs `value`. */
const CHILDLESS_ELEMENTS = new Set([...VOID_ELEMENTS, 'textarea']);

/** The filler the synthesizer produces for a node-typed prop such as `children`. */
const GENERIC_CHILDREN = new Set([ELEMENT_CONTENT, TEXT_CONTENT]);

/** HTML only accepts specific content inside these hosts; a <div> is invalid. */
const CHILD_CONTENT = new Map<string, string>([
  ['table', '<tbody><tr><td>Example content</td></tr></tbody>'],
  ['thead', '<tr><th>Example content</th></tr>'],
  ['tbody', '<tr><td>Example content</td></tr>'],
  ['tfoot', '<tr><td>Example content</td></tr>'],
  ['tr', '<td>Example content</td>'],
  ['select', '<option>Example content</option>'],
  ['optgroup', '<option>Example content</option>'],
  ['ul', '<li>Example content</li>'],
  ['ol', '<li>Example content</li>'],
  ['dl', '<dt>Example content</dt>'],
  ...['p', 'a', 'button', 'label', 'caption', 'td', 'th', 'li', 'option', 'span'].map(
    (tag) => [tag, "'Example content'"] as const,
  ),
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => [tag, "'Example content'"] as const),
]);

function referencesChildren(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === 'children';
  let found = false;
  ts.forEachChild(node, (child) => {
    found ||= referencesChildren(child);
  });
  return found;
}

/**
 * The intrinsic element a component's own props and children land in — either
 * the tag it spreads props into (`<input {...props} />`) or the one wrapping
 * `{children}`. Returns undefined for wrappers around other components, whose
 * content rules we cannot know statically.
 */
function hostElement(symbol: ts.Symbol): string | undefined {
  let spreadHost: string | undefined;
  let childrenHost: string | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) {
        if (node.attributes.properties.some(ts.isJsxSpreadAttribute)) spreadHost ??= tag.text;
      }
    }
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName;
      // `{children}` is often wrapped — `{children ?? fallback}`, `{children}` in
      // a fragment — so look for the identifier anywhere in the expression.
      const wrapsChildren = node.children.some(
        (child) =>
          ts.isJsxExpression(child) &&
          child.expression !== undefined &&
          referencesChildren(child.expression),
      );
      if (wrapsChildren && ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) {
        childrenHost ??= tag.text;
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const declaration of symbol.getDeclarations() ?? []) visit(declaration);
  return childrenHost ?? spreadHost;
}

function parseConfig(tsconfigPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  } as ts.ParseConfigFileHost);

  if (!parsed) throw new Error(`Unable to read ${tsconfigPath}`);
  return parsed;
}

function findExportSymbol({
  checker,
  sourceFile,
  exportName,
  isDefault,
}: {
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
  exportName: string;
  isDefault: boolean;
}): ts.Symbol | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return undefined;

  const wanted = isDefault ? 'default' : exportName;
  const symbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((candidate) => candidate.getName() === wanted);

  if (symbol && symbol.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol);
  return symbol;
}

/**
 * Builds a TypeScript program for a workspace and derives dummy Storybook args
 * from each component's real props type. Required props have to be filled in,
 * otherwise the generated story neither typechecks nor renders.
 */
export function createPropsAnalyzer({ tsconfigPath }: { tsconfigPath: string }): PropsAnalyzer {
  const parsed = parseConfig(tsconfigPath);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  return {
    getArgs({ file, exportName, isDefault }) {
      const sourceFile = program.getSourceFile(file) ?? program.getSourceFile(path.resolve(file));
      if (!sourceFile) return { code: null, error: 'not part of the TypeScript program' };

      const symbol = findExportSymbol({ checker, sourceFile, exportName, isDefault });
      if (!symbol) return { code: null, error: `export ${exportName} not found` };

      const type = checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
      const signature = type
        .getCallSignatures()
        .find((candidate) => candidate.getParameters().length > 0);

      if (type.getCallSignatures().length === 0) {
        return { code: null, error: 'not a callable component' };
      }
      if (!signature) return { code: null };

      const declaredProps = checker.getTypeOfSymbolAtLocation(
        signature.getParameters()[0],
        sourceFile,
      );
      // A union props type (discriminated variants) only exposes the shared
      // members, so args built from it satisfy no single variant. Target the
      // first variant instead.
      const propsType = declaredProps.isUnion() ? declaredProps.types[0] : declaredProps;
      const required = propsType
        .getProperties()
        .filter((property) => !(property.flags & ts.SymbolFlags.Optional));

      // Optional props worth filling in anyway: without children most wrappers
      // render an empty box, and dialogs/sheets stay closed without `open`.
      const host = hostElement(symbol);
      const acceptsChildren = host === undefined || !CHILDLESS_ELEMENTS.has(host);
      const optionalExtras = propsType.getProperties().filter((property) => {
        if (!(property.flags & ts.SymbolFlags.Optional)) return false;
        const name = property.getName();
        if (OPTIONAL_EXCLUDED.has(name) || /^(aria-|data-)/.test(name)) return false;
        if (name === 'children') return acceptsChildren;
        if (name === 'open') return true;
        if (isInheritedLibraryProp(property)) return false;
        return isSimpleType({
          checker,
          type: checker.getTypeOfSymbolAtLocation(property, sourceFile),
        });
      });

      if (required.length === 0 && optionalExtras.length === 0) return { code: null };

      const ctx = createSynthContext({ checker, node: sourceFile });
      const entries: string[] = [];
      const unsupported: string[] = [];
      const valueFor = (property: ts.Symbol): string | null => {
        const value = synthesizeValue({
          type: checker.getTypeOfSymbolAtLocation(property, sourceFile),
          ctx,
          propertyName: property.getName(),
        });
        if (value === null || host === undefined || !GENERIC_CHILDREN.has(value)) return value;
        return CHILD_CONTENT.get(host) ?? value;
      };

      for (const property of required) {
        const value = valueFor(property);
        if (value === null) {
          unsupported.push(property.getName());
          continue;
        }
        entries.push(`    ${jsPropertyKey(property.getName())}: ${value},`);
      }

      if (unsupported.length > 0) {
        return { code: null, error: `unsupported required props: ${unsupported.join(', ')}` };
      }

      for (const property of optionalExtras) {
        const value = valueFor(property);
        if (value !== null) entries.push(`    ${jsPropertyKey(property.getName())}: ${value},`);
      }

      if (entries.length === 0) return { code: null };

      return { code: `{\n${entries.join('\n')}\n  }` };
    },
  };
}
