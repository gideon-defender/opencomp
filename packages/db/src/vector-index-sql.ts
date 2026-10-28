import { Prisma } from '@prisma/client';
import type { VectorMetadata, VectorRecord } from './vector-index-types.js';

export interface VectorRow {
  id: string;
  score?: number | string;
  embedding?: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  content: string | null;
  policyName: string | null;
  contextQuestion: string | null;
  documentName: string | null;
  manualAnswerQuestion: string | null;
  department: string | null;
  updatedAt: Date | null;
  embeddingModel: string | null;
}

export const METADATA_SELECT = Prisma.sql`
  "organizationId",
  "sourceType",
  "sourceId",
  "content",
  "policyName",
  "contextQuestion",
  "documentName",
  "manualAnswerQuestion",
  "department",
  "updatedAt",
  "embeddingModel"
`;

// Only `sourceType`/`sourceId` may be supplied through the filter DSL — the
// owning `organizationId` is always added explicitly by the callers' tenant
// scope, so it is intentionally not read from the filter string.
const FILTER_COLUMNS = new Set(['sourceType', 'sourceId']);

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function parseVector(value: unknown): number[] | undefined {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner.length === 0) return [];
      return inner.split(',').map((part) => Number(part.trim()));
    }
  }
  return undefined;
}

export function rowToMetadata(row: VectorRow): VectorMetadata {
  return {
    embeddingModel: row.embeddingModel,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    content: row.content,
    policyName: row.policyName,
    contextQuestion: row.contextQuestion,
    documentName: row.documentName,
    manualAnswerQuestion: row.manualAnswerQuestion,
    department: row.department,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export function rowToRecord(row: VectorRow): VectorRecord {
  return { id: row.id, metadata: rowToMetadata(row) };
}

export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Parses Upstash's filter DSL subset used by the codebase:
//   `sourceType = "y" AND sourceId = "z"`.
// Only equality on the two indexed metadata columns is supported; anything
// else is ignored so queries degrade to a full similarity search.
function filterConditions(filter?: string): Prisma.Sql[] {
  if (!filter) return [];
  const conditions: Prisma.Sql[] = [];
  // Linear scan for `key = "value"` pairs instead of a regex exec loop —
  // CodeQL js/polynomial-redos: the equivalent pattern backtracks
  // quadratically on uncontrolled filter strings (e.g. long word-char runs
  // with no '='). This scan advances monotonically and never re-examines
  // characters, so worst case stays O(n).
  let idx = 0;
  while (idx < filter.length) {
    const eq = filter.indexOf('=', idx);
    if (eq === -1) break;

    // Walk backwards over whitespace, then over key characters.
    let keyEnd = eq;
    while (keyEnd > idx && /\s/.test(filter[keyEnd - 1]!)) keyEnd--;
    const isKeyChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
    let keyStart = keyEnd;
    while (keyStart > 0 && isKeyChar(filter[keyStart - 1]!)) keyStart--;
    const key = filter.slice(keyStart, keyEnd);

    if (key.length > 0 && /^[A-Za-z_]/.test(key) && FILTER_COLUMNS.has(key)) {
      // Skip whitespace after '=', then require an opening double quote.
      let v = eq + 1;
      while (v < filter.length && /\s/.test(filter[v]!)) v++;
      if (filter[v] === '"') {
        const close = filter.indexOf('"', v + 1);
        if (close === -1) break; // unterminated quote — nothing more to parse
        conditions.push(Prisma.sql`"${Prisma.raw(key)}" = ${filter.slice(v + 1, close)}`);
        idx = close + 1;
        continue;
      }
    }
    idx = eq + 1;
  }
  return conditions;
}

export function tenantWhere(organizationId: string, filter?: string): Prisma.Sql {
  const conditions = [Prisma.sql`"organizationId" = ${organizationId}`];
  conditions.push(...filterConditions(filter));
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

export function idsInClause(ids: string[]): Prisma.Sql {
  return Prisma.sql`IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})`;
}
