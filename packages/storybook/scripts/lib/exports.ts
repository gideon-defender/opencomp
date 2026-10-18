import ts from 'typescript';

export interface ComponentExport {
  /** Local name to bind in the story file. */
  name: string;
  /** True when the component is the module's default export. */
  isDefault: boolean;
}

export interface ModuleExports {
  hasDefault: boolean;
  defaultName?: string;
  named: string[];
  /** Names declared with `async` — React Server Components. */
  asyncNames: Set<string>;
  /** Names whose every return path is `null`/`undefined` — nothing to show. */
  emptyRenderNames: Set<string>;
  /** URL query keys that gate an overlay open, mapped to the value to seed. */
  urlState: Record<string, string>;
  /** True when the component only renders below the `md` breakpoint. */
  mobileOnly: boolean;
}

const OVERLAY_OPEN = /<(?:Sheet|Dialog|AlertDialog|Drawer|Popover|Collapsible)\s+open=/;
const OVERLAY_KEY = /sheet|dialog|modal|drawer/i;

/**
 * The literal a query-state value is compared against, e.g. `'done-for-you'`
 * for `if (checkoutComplete === 'done-for-you')`. Seeding the generic `'true'`
 * would leave such a component closed.
 */
function comparedLiteral(sourceFile: ts.SourceFile, variable: string): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      found === undefined &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === variable &&
      ts.isStringLiteralLike(node.right)
    ) {
      found = node.right.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The name bound to the first element of `const [name, setName] = hook(...)`. */
function destructuredName(call: ts.CallExpression): string | undefined {
  const declaration = call.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isArrayBindingPattern(declaration.name)) {
    return undefined;
  }
  const [first] = declaration.name.elements;
  if (!first || !ts.isBindingElement(first) || !ts.isIdentifier(first.name)) return undefined;
  return first.name.text;
}

/**
 * Query keys a component reads from the URL, via nuqs' `useQueryState('k')` or
 * `useSearchParams().get('k')`. Containers whose only job is to open an overlay
 * when its key is set render nothing in a story unless the key is seeded, so
 * the generator forwards these as `parameters.searchParams`.
 *
 * Keys are only reported when the file actually gates an overlay on them, so a
 * component using query state for, say, a tab index is left alone.
 */
function readUrlState(sourceFile: ts.SourceFile, source: string): Record<string, string> {
  const gatesOverlay = OVERLAY_OPEN.test(source);
  const state: Record<string, string> = {};

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const callee = node.expression;
      const isQueryState =
        ts.isIdentifier(callee) &&
        (callee.text === 'useQueryState' || callee.text === 'useQueryStates');
      const isParamsGet =
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'get' &&
        /earchParams$/.test(callee.expression.getText(sourceFile));

      if ((isQueryState || isParamsGet) && first && ts.isStringLiteralLike(first)) {
        if (gatesOverlay || OVERLAY_KEY.test(first.text)) {
          const direct =
            ts.isBinaryExpression(node.parent) &&
            node.parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
            ts.isStringLiteralLike(node.parent.right)
              ? node.parent.right.text
              : undefined;
          const variable = isQueryState ? destructuredName(node) : undefined;
          state[first.text] =
            direct ?? (variable ? comparedLiteral(sourceFile, variable) : undefined) ?? 'true';
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return state;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function collectBindingNames(name: ts.BindingName, into: string[]): void {
  if (ts.isIdentifier(name)) {
    into.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, into);
  }
}

/**
 * True when every `return` in the function body yields `null` or `undefined`.
 * Such components exist only for side effects (analytics pings, hotkey
 * listeners) and have no visual output worth a story.
 */
function alwaysRendersNothing(fn: ts.SignatureDeclaration): boolean {
  const body = (fn as ts.FunctionLikeDeclaration).body;
  if (!body) return false;
  // A concise arrow body (`() => null`) has no return statement.
  if (!ts.isBlock(body)) return body.kind === ts.SyntaxKind.NullKeyword;

  let total = 0;
  let empty = 0;
  const visit = (node: ts.Node): void => {
    // Don't descend into nested functions; their returns are not the
    // component's render output.
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      total += 1;
      const expression = node.expression;
      if (
        !expression ||
        expression.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(expression) && expression.text === 'undefined')
      ) {
        empty += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  return total > 0 && total === empty;
}

/**
 * Returns the exported value names of a module. Type-only exports are skipped
 * because they cannot be referenced as a Storybook `component`.
 */
export function readModuleExports(source: string, fileName: string): ModuleExports {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );

  const named: string[] = [];
  const asyncNames = new Set<string>();
  const emptyRenderNames = new Set<string>();
  let hasDefault = false;
  let defaultName: string | undefined;

  const hasExportModifier = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  const hasDefaultModifier = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  const isAsync = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      hasDefault = true;
      if (ts.isIdentifier(statement.expression)) defaultName = statement.expression.text;
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.exportClause) continue;
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        if (element.name.text === 'default') hasDefault = true;
        else named.push(element.name.text);
      }
      continue;
    }

    if (!hasExportModifier(statement)) continue;

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (hasDefaultModifier(statement)) {
        hasDefault = true;
        defaultName = statement.name?.text;
        if (isAsync(statement)) asyncNames.add(defaultName ?? 'default');
        if (ts.isFunctionDeclaration(statement) && alwaysRendersNothing(statement)) {
          emptyRenderNames.add(defaultName ?? 'default');
        }
      } else if (statement.name) {
        named.push(statement.name.text);
        if (isAsync(statement)) asyncNames.add(statement.name.text);
        if (ts.isFunctionDeclaration(statement) && alwaysRendersNothing(statement)) {
          emptyRenderNames.add(statement.name.text);
        }
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, named);
        const initializer = declaration.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
          ts.isIdentifier(declaration.name)
        ) {
          if (isAsync(initializer)) asyncNames.add(declaration.name.text);
          if (alwaysRendersNothing(initializer)) emptyRenderNames.add(declaration.name.text);
        }
      }
    }
  }

  return {
    hasDefault,
    defaultName,
    named,
    asyncNames,
    emptyRenderNames,
    urlState: readUrlState(sourceFile, source),
    // A `md:hidden` root is a mobile-only affordance; it is correctly invisible
    // at a desktop width, so its story needs a narrow viewport.
    mobileOnly: /\bmd:hidden\b/.test(source),
  };
}

/**
 * Picks the component a story should render: the export matching the file's
 * PascalCase name, else the default export, else a single component-looking
 * named export. Returns null when nothing renderable is exported.
 */
export function pickComponentExport({
  exports: moduleExports,
  expectedName,
}: {
  exports: ModuleExports;
  expectedName: string;
}): ComponentExport | null {
  const pascalNamed = moduleExports.named.filter(isPascalCase);

  if (pascalNamed.includes(expectedName)) {
    return { name: expectedName, isDefault: false };
  }

  if (moduleExports.hasDefault) {
    const name =
      moduleExports.defaultName && isPascalCase(moduleExports.defaultName)
        ? moduleExports.defaultName
        : expectedName;
    return { name, isDefault: true };
  }

  if (pascalNamed.length > 0) {
    return { name: pascalNamed[0], isDefault: false };
  }

  return null;
}
