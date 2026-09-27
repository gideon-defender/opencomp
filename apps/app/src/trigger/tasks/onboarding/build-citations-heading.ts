import type { MitigationCitation } from './select-mitigation-citations';

export interface CitationsHeadingInput {
  /** The 5 citations the LLM wrote sentences for. */
  citations: MitigationCitation[];
  /**
   * Total linked work counts for the entity (risk or vendor) — these are
   * what the user sees in the "Linked work" column of the UI. The citation
   * list is a curated subset (max 3 controls + 2 tasks); the heading uses
   * these totals so it never under-reports vs. the column.
   */
  linkedTotals: { controls: number; tasks: number };
  /**
   * BCP-47 locale for the full heading copy (nouns, template, and list
   * conjunction). Callers should pass the user's locale; defaults to
   * English for background jobs without request context.
   */
  locale?: string;
}

/**
 * Builds the intro sentence above the citation bullets in a treatment plan.
 *
 * The number we publish in the prose has to match what the user sees in the
 * Linked Work column. The previous version counted citations, which capped
 * at 3 controls + 2 tasks — so a risk with 6 linked controls + 8 linked
 * tasks read as "3 controls and 2 tasks" in the prose, contradicting the
 * UI. We now report the full linked totals and label the bullets below as
 * "Highlights" when they're a strict subset.
 *
 *   linked 6 controls + 8 tasks, citations subset → "...through 6 controls
 *     and 8 tasks. Highlights below:"
 *   linked 2 controls + 1 task, citations cover all → "...through 2 controls
 *     and 1 task:"
 *   no linked work (only gaps/policies in citations) → fallback intro that
 *     describes the citation kinds.
 *
 * Pure function; lives in its own file so unit tests don't need to load
 * the DB client (which `onboard-organization-helpers.ts` imports at the
 * top level).
 */
interface HeadingCopy {
  controlOne: string;
  controlMany: string;
  taskOne: string;
  taskMany: string;
  policyOne: string;
  policyMany: string;
  recommendedGapOne: string;
  recommendedGapMany: string;
  introThrough: string;
  introBare: string;
  highlightsTail: string;
}

const EN_COPY: HeadingCopy = {
  controlOne: 'control',
  controlMany: 'controls',
  taskOne: 'task',
  taskMany: 'tasks',
  policyOne: 'policy',
  policyMany: 'policies',
  recommendedGapOne: 'recommended gap',
  recommendedGapMany: 'recommended gaps',
  introThrough: 'This plan addresses the risk through',
  introBare: 'This plan addresses the risk:',
  highlightsTail: '. Highlights below:',
};

const ES_COPY: HeadingCopy = {
  controlOne: 'control',
  controlMany: 'controles',
  taskOne: 'tarea',
  taskMany: 'tareas',
  policyOne: 'política',
  policyMany: 'políticas',
  recommendedGapOne: 'brecha recomendada',
  recommendedGapMany: 'brechas recomendadas',
  introThrough: 'Este plan aborda el riesgo a través de',
  introBare: 'Este plan aborda el riesgo:',
  highlightsTail: '. Aspectos destacados a continuación:',
};

export function buildCitationsHeading({
  citations,
  linkedTotals,
  locale = 'en',
}: CitationsHeadingInput): string {
  const copy = locale === 'es' ? ES_COPY : EN_COPY;
  const formatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });

  // Happy path: at least one linked control or task exists. Report the
  // totals (matches the UI) and add "Highlights below:" when the bullets
  // are a strict subset of the linked work + any policy/gap citations.
  if (linkedTotals.controls > 0 || linkedTotals.tasks > 0) {
    const parts: string[] = [];
    if (linkedTotals.controls > 0) {
      parts.push(
        `${linkedTotals.controls} ${linkedTotals.controls === 1 ? copy.controlOne : copy.controlMany}`,
      );
    }
    if (linkedTotals.tasks > 0) {
      parts.push(
        `${linkedTotals.tasks} ${linkedTotals.tasks === 1 ? copy.taskOne : copy.taskMany}`,
      );
    }
    const citedControls = citations.filter((c) => c.kind === 'control').length;
    const citedTasks = citations.filter((c) => c.kind === 'task').length;
    const showsHighlights =
      citedControls < linkedTotals.controls ||
      citedTasks < linkedTotals.tasks ||
      citations.some((c) => c.kind === 'gap' || c.kind === 'policy');
    const tail = showsHighlights ? copy.highlightsTail : ':';
    return `${copy.introThrough} ${formatter.format(parts)}${tail}`;
  }

  // No linked work. Fall back to describing the citation kinds present —
  // these are the only thing the bullets can talk about.
  const policyCount = citations.filter((c) => c.kind === 'policy').length;
  const gapCount = citations.filter((c) => c.kind === 'gap').length;
  const parts: string[] = [];
  if (policyCount > 0) {
    parts.push(
      `${policyCount} ${policyCount === 1 ? copy.policyOne : copy.policyMany}`,
    );
  }
  if (gapCount > 0) {
    parts.push(
      `${gapCount} ${gapCount === 1 ? copy.recommendedGapOne : copy.recommendedGapMany}`,
    );
  }
  if (parts.length === 0) {
    return copy.introBare;
  }
  return `${copy.introThrough} ${formatter.format(parts)}:`;
}
