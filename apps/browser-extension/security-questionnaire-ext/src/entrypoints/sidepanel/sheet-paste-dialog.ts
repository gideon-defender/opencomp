import { t } from '../../lib/i18n';
import type { SheetPastePayload } from '../../lib/sheets-paste-plan';

export function showSheetPasteDialog(paste: SheetPastePayload): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.innerHTML = renderDialog(paste);
    document.body.appendChild(container);

    const close = (confirmed: boolean): void => {
      container.remove();
      resolve(confirmed);
    };
    const handleCopy = (): void => {
      void copyText(paste.tsv).then(
        () => setStatus(container, t('sheetPasteCopied')),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : t('sidepanelUnableCopy');
          setStatus(container, message);
        },
      );
    };

    handleCopy();
    container
      .querySelector('[data-dialog="cancel"]')
      ?.addEventListener('click', () => close(false));
    container
      .querySelector('[data-dialog="confirm"]')
      ?.addEventListener('click', () => close(true));
    container.querySelector('[data-dialog="copy"]')?.addEventListener('click', handleCopy);
  });
}

function renderDialog(paste: SheetPastePayload): string {
  const title =
    paste.itemIds.length === 1
      ? t('sheetPasteTitleOne', String(paste.itemIds.length))
      : t('sheetPasteTitleOther', String(paste.itemIds.length));
  return `
    <div class="modal">
      <div class="backdrop"></div>
      <section class="dialog">
        <div class="eyebrow">${escapeHtml(t('sheetPasteEyebrow'))}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(t('sheetPasteInstructions', paste.range))}</p>
        <p class="paste-status" data-paste-status>${escapeHtml(t('sheetPasteCopying'))}</p>
        <div class="dialog-actions">
          <button class="secondary" type="button" data-dialog="copy">${escapeHtml(t('sheetPasteCopyAgain'))}</button>
          <button class="secondary" type="button" data-dialog="cancel">${escapeHtml(t('commonCancel'))}</button>
          <button class="primary" type="button" data-dialog="confirm">${escapeHtml(t('sheetPasteConfirm'))}</button>
        </div>
      </section>
    </div>
  `;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text).catch(() => copyWithSelection(text));
    return;
  }
  await copyWithSelection(text);
}

async function copyWithSelection(text: string): Promise<void> {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.left = '-9999px';
  textarea.style.position = 'fixed';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error(t('sidepanelUnableCopy'));
}

function setStatus(container: HTMLElement, message: string): void {
  const status = container.querySelector('[data-paste-status]');
  if (status instanceof HTMLElement) status.textContent = message;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
