import ts from 'typescript';
import { jsPropertyKey, jsString } from './emit';

const MAX_DEPTH = 3;
/** How many items to put in a synthesized array. */
const ARRAY_LENGTH = 3;

/** Filler for element-typed props, and for node-typed props that accept text. */
export const ELEMENT_CONTENT = '<div>Example content</div>';
export const TEXT_CONTENT = "'Example content'";

interface SynthContext {
  checker: ts.TypeChecker;
  node: ts.Node;
  depth: number;
  /** Position within a synthesized array, used to vary sample values. */
  index?: number;
}

/** A minimal but valid unified diff, for components that parse a patch. */
const UNIFIED_DIFF = [
  'diff --git a/policy.md b/policy.md',
  'index 1111111..2222222 100644',
  '--- a/policy.md',
  '+++ b/policy.md',
  '@@ -1,3 +1,3 @@',
  ' # Access Control Policy',
  '-Reviewed annually.',
  '+Reviewed quarterly.',
  ' Owner: Security team.',
].join('\n');

const NAME_HINTS: Array<[RegExp, string]> = [
  [/(^|[a-z])(id|Id)$/, 'demo_id'],
  [/email/i, 'person@example.com'],
  [/(url|href|link)$/i, 'https://example.com'],
  [/hostname|domain/i, 'example.com'],
  [/slug/i, 'example-slug'],
  // `resource:action` — permission gates render their fallback otherwise.
  [/^permission$/i, 'risk:update'],
  [/(^|[a-z])(at|At)$|date/i, '2026-01-01T00:00:00.000Z'],
  // Diff renderers parse this and render nothing when it isn't a real patch.
  [/^(patch|diff)$/i, UNIFIED_DIFF],
  [/title|label|heading/i, 'Example title'],
  [/description|summary|body|content|text/i, 'Example description'],
  [/name/i, 'Example name'],
];

/** Brand-ish palette so charts and badges render distinguishable segments. */
const COLORS = ['#1d4e3f', '#2f8f6f', '#7fc2ab', '#c7e5da'];

function stringFor({ propertyName, index }: { propertyName?: string; index?: number }): string {
  if (propertyName && /colou?r$/i.test(propertyName)) {
    return jsString(COLORS[(index ?? 0) % COLORS.length]);
  }

  const base = (() => {
    if (!propertyName) return 'Example';
    for (const [pattern, value] of NAME_HINTS) {
      if (pattern.test(propertyName)) return value;
    }
    return 'Example';
  })();

  // Ids and names must stay unique — they are routinely used as React keys.
  if (index === undefined) return jsString(base);
  if (base === UNIFIED_DIFF) return jsString(base);
  if (base === 'demo_id') return jsString(`demo_id_${index + 1}`);
  if (/^https?:/.test(base)) return jsString(`${base}/${index + 1}`);
  if (base.includes('@')) return jsString(`person${index + 1}@example.com`);
  if (/^2026-/.test(base)) return jsString(base);
  return jsString(`${base} ${index + 1}`);
}

/**
 * Booleans default to `true` so gated UI actually renders — components
 * routinely bail out early on `isOwner`, `open` or `enabled`. Flags that
 * *suppress* or degrade the UI keep their falsy default.
 */
const FALSE_BY_DEFAULT =
  /^(is|has|show|should)?_?(disabled|readonly|readOnly|hidden|loading|pending|busy|skeleton|error|invalid|destructive|danger|archived|deleted|dirty)$/i;

function booleanFor(propertyName: string): string {
  return FALSE_BY_DEFAULT.test(propertyName) ? 'false' : 'true';
}

function isDateType(type: ts.Type): boolean {  return type.getSymbol()?.getName() === 'Date';
}

function isReactNodeType({ checker, type }: { checker: ts.TypeChecker; type: ts.Type }): boolean {
  return /^(React\.)?(ReactNode|ReactElement(<.*>)?|JSX\.Element|Element)$/.test(
    checker.typeToString(type),
  );
}

/** Only an element satisfies `ReactElement`; `ReactNode` also accepts text. */
function isReactElementType({ checker, type }: { checker: ts.TypeChecker; type: ts.Type }): boolean {
  return /^(React\.)?(ReactElement(<.*>)?|JSX\.Element|Element)$/.test(checker.typeToString(type));
}

function synthesizeFunction({
  signature,
  ctx,
}: {
  signature: ts.Signature;
  ctx: SynthContext;
}): string {
  const returnType = ctx.checker.getReturnTypeOfSignature(signature);
  const returnText = ctx.checker.typeToString(returnType);

  if (/^Promise<(void|any|unknown)>$/.test(returnText)) return 'async () => {}';
  if (returnText === 'void' || returnText === 'any' || returnText === 'unknown') return '() => {}';

  const promised = /^Promise<(.+)>$/.exec(returnText);
  const inner = promised
    ? ctx.checker.getTypeArguments(returnType as ts.TypeReference)[0]
    : returnType;
  const value = synthesizeValue({ type: inner, ctx: { ...ctx, depth: ctx.depth + 1 } });
  if (value === null) return promised ? 'async () => {}' : '() => {}';
  return promised ? `async () => (${value})` : `() => (${value})`;
}

function synthesizeObject({ type, ctx }: { type: ts.Type; ctx: SynthContext }): string | null {
  if (ctx.depth >= MAX_DEPTH) return null;

  const entries: string[] = [];
  for (const property of type.getProperties()) {
    if (property.flags & ts.SymbolFlags.Optional) continue;
    const propertyType = ctx.checker.getTypeOfSymbolAtLocation(property, ctx.node);
    const value = synthesizeValue({
      type: propertyType,
      ctx: { ...ctx, depth: ctx.depth + 1 },
      propertyName: property.getName(),
    });
    if (value === null) return null;
    entries.push(`${jsPropertyKey(property.getName())}: ${value}`);
  }

  return `{ ${entries.join(', ')} }`;
}

/**
 * Renders a TypeScript type as a literal expression usable as a Storybook arg.
 * Returns null when the type can't be represented (generics, opaque classes),
 * which tells the generator to skip the story rather than emit broken code.
 */
export function synthesizeValue({
  type,
  ctx,
  propertyName,
}: {
  type: ts.Type;
  ctx: SynthContext;
  propertyName?: string;
}): string | null {
  const { checker } = ctx;
  const flags = type.flags;

  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return null;
  if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return 'undefined';
  if (flags & ts.TypeFlags.Null) return 'null';
  if (type.isStringLiteral()) return jsString(type.value);
  if (type.isNumberLiteral()) return String(type.value);
  if (flags & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type);
  if (flags & ts.TypeFlags.String) return stringFor({ propertyName, index: ctx.index });
  if (flags & ts.TypeFlags.Number) {
    // Vary numbers so charts show distinct segments instead of equal slices.
    return String([42, 28, 15, 9][(ctx.index ?? 0) % 4]);
  }
  if (flags & ts.TypeFlags.Boolean) return booleanFor(propertyName ?? '');
  if (flags & ts.TypeFlags.BigInt) return '0n';
  if (flags & ts.TypeFlags.ESSymbol) return null;

  // A JSX element satisfies ReactNode and the stricter ReactElement alike,
  // but `children` is sometimes typed as a plain string — let the union
  // branch below pick the string in that case.
  // A `<div>` is illegal inside hosts like <p> or <table>, so plain text is the
  // safe default; only a prop that demands an element gets one.
  if (isReactElementType({ checker, type })) return ELEMENT_CONTENT;
  if (isReactNodeType({ checker, type })) return TEXT_CONTENT;
  // Render-prop `children` ((hunks) => ReactNode) must not become an element:
  // the component would mount our node where it expects its own output.
  if (
    propertyName === 'children' &&
    !type.isUnion() &&
    type.getCallSignatures().length === 0 &&
    type.getConstructSignatures().length === 0
  ) {
    return ELEMENT_CONTENT;
  }
  if (isDateType(type)) return "new Date('2026-01-01T00:00:00.000Z')";

  if (type.isUnion()) {
    const candidates = type.types.filter(
      (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    );
    for (const member of candidates.length > 0 ? candidates : type.types) {
      const value = synthesizeValue({ type: member, ctx, propertyName });
      if (value !== null) return value;
    }
    return null;
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    if (checker.isTupleType(type)) return null;
    if (ctx.depth >= MAX_DEPTH) return '[]';

    const [elementType] = checker.getTypeArguments(type as ts.TypeReference);
    if (!elementType) return '[]';

    // Synthesize each item separately so ids/names stay unique — components
    // routinely use them as React keys, and duplicates break rendering.
    const items: string[] = [];
    for (let index = 0; index < ARRAY_LENGTH; index += 1) {
      const item = synthesizeValue({
        type: elementType,
        ctx: { ...ctx, depth: ctx.depth + 1, index },
        propertyName,
      });
      // An unrepresentable element type yields an empty array rather than a
      // skipped story: the component still renders its empty state.
      if (item === null) return '[]';
      items.push(item);
    }
    return `[${items.join(', ')}]`;
  }

  if (/^(Map|Set|WeakMap|WeakSet|RegExp|Promise)</.test(checker.typeToString(type))) return null;

  const callSignatures = type.getCallSignatures();
  if (callSignatures.length > 0) {
    return synthesizeFunction({ signature: callSignatures[0], ctx });
  }

  if (type.isClassOrInterface() || flags & ts.TypeFlags.Object) {
    return synthesizeObject({ type, ctx });
  }

  return null;
}

export function createSynthContext({
  checker,
  node,
}: {
  checker: ts.TypeChecker;
  node: ts.Node;
}): SynthContext {
  return { checker, node, depth: 0 };
}
