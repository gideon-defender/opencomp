import { t } from '../../lib/i18n';
import type { SheetMapping } from '../../lib/types';

export function renderSheetMappingBar(params: {
  mapping: SheetMapping | null;
  surface: string;
}): string {
  if (params.surface !== 'sheets') return '';
  if (!params.mapping) {
    return `
      <section class="sheet-map">
        <div class="sheet-map-text">
          <span class="eyebrow">${escapeHtml(t('sheetMapEyebrow'))}</span>
          <strong>${escapeHtml(t('sheetMapSetColumns'))}</strong>
          <span>${escapeHtml(t('sheetMapNoMapping'))}</span>
        </div>
        <button class="secondary xs" data-action="change-sheet-mapping">${escapeHtml(t('sheetMapSet'))}</button>
      </section>
    `;
  }

  const badge = params.mapping.confirmed ? t('sheetMapSaved') : t('sheetMapAuto');
  return `
    <section class="sheet-map">
      <div class="sheet-map-text">
        <span class="eyebrow">${escapeHtml(t('sheetMapEyebrow'))}</span>
        <strong>${escapeHtml(t('sheetMapQuestionsAnswers', [params.mapping.questionColumn, params.mapping.answerColumn]))}</strong>
        <span>${escapeHtml(t('sheetMapRows', formatRows(params.mapping)))}</span>
      </div>
      <span class="map-pill ${params.mapping.confirmed ? 'confirmed' : 'auto'}">${escapeHtml(badge)}</span>
      <button class="secondary xs" data-action="change-sheet-mapping">${escapeHtml(t('sheetMapChange'))}</button>
    </section>
  `;
}

export function renderSheetMappingDialog(mapping: SheetMapping): string {
  return `
    <div class="modal">
      <div class="backdrop"></div>
      <section class="dialog">
        <form class="sheet-map-form" data-sheet-mapping-form>
          <div class="eyebrow">${escapeHtml(t('sheetMapEyebrow'))}</div>
          <h2>${escapeHtml(t('sheetMapReviewTargets'))}</h2>
          <div class="map-grid">
            ${inputField({
              label: t('sheetMapQuestionColumn'),
              name: 'questionColumn',
              value: mapping.questionColumn,
            })}
            ${inputField({
              label: t('sheetMapAnswerColumn'),
              name: 'answerColumn',
              value: mapping.answerColumn,
            })}
            ${numberField({
              label: t('sheetMapStartRow'),
              name: 'startRow',
              value: String(mapping.startRow),
            })}
            ${numberField({
              label: t('sheetMapEndRow'),
              name: 'endRow',
              value: mapping.endRow ? String(mapping.endRow) : '',
            })}
          </div>
          <p class="form-error" data-sheet-mapping-error hidden></p>
          <div class="dialog-actions">
            <button class="secondary" type="button" data-dialog="cancel">${escapeHtml(t('commonCancel'))}</button>
            <button class="primary" type="submit" data-dialog="confirm">${escapeHtml(t('sheetMapSave'))}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function inputField(params: { label: string; name: string; value: string }): string {
  return `
    <label>
      <span>${escapeHtml(params.label)}</span>
      <input
        autocomplete="off"
        maxlength="3"
        name="${escapeHtml(params.name)}"
        pattern="[A-Za-z]+"
        required
        value="${escapeHtml(params.value)}"
      />
    </label>
  `;
}

function numberField(params: { label: string; name: string; value: string }): string {
  return `
    <label>
      <span>${escapeHtml(params.label)}</span>
      <input
        min="1"
        name="${escapeHtml(params.name)}"
        type="number"
        value="${escapeHtml(params.value)}"
      />
    </label>
  `;
}

function formatRows(mapping: SheetMapping): string {
  return mapping.endRow ? `${mapping.startRow}-${mapping.endRow}` : `${mapping.startRow}+`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
