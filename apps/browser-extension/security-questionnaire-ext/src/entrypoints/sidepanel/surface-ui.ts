import { extensionConfig } from '../../lib/config';
import { t } from '../../lib/i18n';
import type { PanelState } from '../../lib/types';

type Surface = PanelState['queue']['surface'];

export function renderSurfaceNote(surface: Surface): string {
  if (surface === 'docs') {
    return `<div class="notice">${escapeHtml(t('surfaceDocsNote'))}</div>`;
  }
  if (surface === 'sheets') return '';
  if (surface === 'forms') {
    return `<div class="notice">${escapeHtml(t('surfaceFormsNote'))}</div>`;
  }
  return '';
}

export function footerButtonLabel(params: {
  approved: number;
  answerCount: number;
  surface: Surface;
}): string {
  if (params.surface === 'docs') {
    return params.answerCount > 0
      ? t('footerCopyAnswers', String(params.answerCount))
      : t('footerGenerateToCopy');
  }
  if (params.surface === 'sheets') {
    if (extensionConfig.googleSheetsApiEnabled) {
      return params.approved > 0
        ? t('footerInsertIntoSheet', String(params.approved))
        : t('footerApproveToInsert');
    }
    return params.approved > 0
      ? t('footerPreparePaste', String(params.approved))
      : t('footerApproveToPaste');
  }
  if (params.approved > 0) return t('footerInsertApproved', String(params.approved));
  return t('footerApproveToInsert');
}

export function footerAction(surface: Surface): string {
  return surface === 'docs' ? 'copy-answers' : 'insert-approved';
}

export function footerDisabled(params: {
  approved: number;
  answerCount: number;
  surface: Surface;
}): string {
  // Docs has no insertion path, so the footer copies instead of inserting and
  // gates on generated answers rather than approvals.
  if (params.surface === 'docs') return params.answerCount === 0 ? 'disabled' : '';
  return params.approved === 0 ? 'disabled' : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
