export const TEMPLATE_CATEGORIES = [
  'evidence_issue',
  'further_evidence',
  'task_specific',
  'na_incorrect',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

type TemplateCategoryLabelKey =
  | 'findings.categoryEvidenceIssue'
  | 'findings.categoryFurtherEvidence'
  | 'findings.categoryTaskSpecific'
  | 'findings.categoryNaIncorrect';

export const CATEGORY_LABEL_KEYS: Record<string, TemplateCategoryLabelKey> = {
  evidence_issue: 'findings.categoryEvidenceIssue',
  further_evidence: 'findings.categoryFurtherEvidence',
  task_specific: 'findings.categoryTaskSpecific',
  na_incorrect: 'findings.categoryNaIncorrect',
};
