import { compMarkSvg } from '../../lib/brand';
import { extensionConfig } from '../../lib/config';
import { t } from '../../lib/i18n';
import type {
  AnswerConfidence,
  Organization,
  PanelState,
  QuestionQueueItem,
  QueueStatus,
} from '../../lib/types';
import { renderSheetMappingBar } from './sheet-mapping-ui';
import { footerAction, footerButtonLabel, footerDisabled, renderSurfaceNote } from './surface-ui';

export function renderSidePanel(state: PanelState, message = '', isRefreshing = false): string {
  if (state.auth.status !== 'authenticated') {
    return shell(`
      <div class="empty">
        <h1>${escapeHtml(t('sidepanelSignInTitle'))}</h1>
        <p>${escapeHtml(t('sidepanelSignInBody'))}</p>
        <button class="primary" data-action="sign-in">${escapeHtml(t('sidepanelSignInButton'))}</button>
      </div>
    `);
  }

  const total = state.queue.items.length;
  const inserted = countByStatus(state.queue.items, 'inserted');
  const approved = countByStatus(state.queue.items, 'approved');
  const generated = countByStatus(state.queue.items, 'generated');
  const generating = countByStatus(state.queue.items, 'generating');
  const flagged = countByStatus(state.queue.items, 'flagged');
  const answerCount = state.queue.items.filter((item) => item.answer).length;
  const progress = total > 0 ? Math.round((inserted / total) * 100) : 0;
  const refreshTitle = isRefreshing ? t('actionRefreshing') : t('actionRefresh');

  return shell(`
    <div class="panel">
      <header class="head">
        <div class="title-row">
          <span class="mark" aria-hidden="true">${compMarkSvg()}</span>
          <h1>${escapeHtml(t('sidepanelTitle'))}</h1>
          <button class="icon ${isRefreshing ? 'refreshing' : ''}" data-action="refresh" title="${escapeHtml(refreshTitle)}" ${isRefreshing ? 'disabled' : ''}>↻</button>
          <button class="icon" data-action="close" title="${escapeHtml(t('actionClose'))}">×</button>
        </div>
        ${renderOrgSelect(state.auth.organizations, state.auth.selectedOrganizationId)}
        <div class="progress"><span style="width:${progress}%"></span></div>
        <div class="legend">
          ${legendItem('inserted', t('legendInserted', String(inserted)))}
          ${legendItem('approved', t('legendApproved', String(approved)))}
          ${generating > 0 ? legendItem('generating', t('legendDrafting', String(generating))) : ''}
          ${generated > 0 ? legendItem('generated', t('legendDrafted', String(generated))) : ''}
          ${flagged > 0 ? legendItem('flagged', t('legendReview', String(flagged))) : ''}
        </div>
      </header>
      <div class="toolbar">
        <button class="primary flex" data-action="generate-all" ${total === 0 || generating > 0 ? 'disabled' : ''}>
          ${generating > 0 ? escapeHtml(t('generatingCount', String(generating))) : escapeHtml(t('generateAll', String(total)))}
        </button>
        <button class="secondary" data-action="approve-all" ${generated === 0 ? 'disabled' : ''}>
          ${escapeHtml(t('approveAll'))}
        </button>
      </div>
      ${renderSurfaceNote(state.queue.surface)}
      ${renderSheetMappingBar({
        mapping: state.queue.sheetMapping,
        surface: state.queue.surface,
      })}
      ${message ? `<div class="notice ${message.startsWith('Scan refreshed') ? 'info' : ''}">${escapeHtml(message)}</div>` : ''}
      <main class="list">
        ${
          total > 0
            ? state.queue.items
                .map((item) =>
                  renderQueueRow({
                    item,
                    canInsertIntoSurface: state.queue.surface !== 'docs',
                    surface: state.queue.surface,
                  }),
                )
                .join('')
            : renderEmptyQueue()
        }
      </main>
      <footer class="foot">
        <button class="primary block" data-action="${footerAction(state.queue.surface)}" ${footerDisabled(
          {
            approved,
            answerCount,
            surface: state.queue.surface,
          },
        )}>
          ${escapeHtml(footerButtonLabel({ approved, answerCount, surface: state.queue.surface }))}
        </button>
      </footer>
    </div>
  `);
}

export function renderDomainDialog(params: { host: string; organizationName: string }): string {
  return dialog(`
    <div class="eyebrow">${escapeHtml(t('dialogConfirmWorkspace'))}</div>
    <h2>${escapeHtml(t('dialogUseOrgHere', params.organizationName))}</h2>
    <p>${escapeHtml(t('dialogAnswersOnHost', params.host))}</p>
    <div class="org-banner">${escapeHtml(params.organizationName)}</div>
    <div class="dialog-actions">
      <button class="secondary" data-dialog="cancel">${escapeHtml(t('commonCancel'))}</button>
      <button class="primary" data-dialog="confirm">${escapeHtml(t('commonConfirm'))}</button>
    </div>
  `);
}

export function renderInsertDialog(params: {
  count: number;
  host: string;
  organizationName: string;
  lowConfidenceCount: number;
  operation?: 'Insert' | 'Copy';
}): string {
  const operation = params.operation ?? 'Insert';
  const translatedOperation = operation === 'Copy' ? t('queueCopy') : t('queueInsert');
  const eyebrow = t('dialogConfirmOperation', translatedOperation.toLowerCase());
  const title =
    operation === 'Copy'
      ? params.count === 1
        ? t('dialogTitleCopyOne', String(params.count))
        : t('dialogTitleCopyOther', String(params.count))
      : params.count === 1
        ? t('dialogTitleInsertOne', String(params.count))
        : t('dialogTitleInsertOther', String(params.count));
  const destination =
    operation === 'Copy'
      ? t('dialogCopyDestination')
      : t('dialogDestination', params.host);
  const lowConfidence =
    params.lowConfidenceCount > 0
      ? params.lowConfidenceCount === 1
        ? t('dialogLowConfidenceOne', String(params.lowConfidenceCount))
        : t('dialogLowConfidenceOther', String(params.lowConfidenceCount))
      : '';
  return dialog(`
    <div class="eyebrow">${escapeHtml(eyebrow)}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(destination)}</p>
    <div class="org-banner">${escapeHtml(params.organizationName)}</div>
    ${lowConfidence ? `<p>${escapeHtml(lowConfidence)}</p>` : ''}
    <div class="dialog-actions">
      <button class="secondary" data-dialog="cancel">${escapeHtml(t('commonCancel'))}</button>
      <button class="primary" data-dialog="confirm">${escapeHtml(t('dialogOperationAsOrg', [translatedOperation, params.organizationName]))}</button>
    </div>
  `);
}

export function renderStaleDialog(staleDraftCount: number): string {
  const title =
    staleDraftCount === 1
      ? t('staleTitleOne', String(staleDraftCount))
      : t('staleTitleOther', String(staleDraftCount));
  return dialog(`
    <div class="eyebrow">${escapeHtml(t('staleEyebrow'))}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(t('staleBody'))}</p>
    <div class="dialog-actions">
      <button class="primary" data-dialog="confirm">${escapeHtml(t('commonDone'))}</button>
    </div>
  `);
}

function renderOrgSelect(
  organizations: Organization[],
  selectedOrganizationId: string | null,
): string {
  const options = organizations
    .map(
      (org) =>
        `<option value="${escapeHtml(org.id)}" ${
          org.id === selectedOrganizationId ? 'selected' : ''
        }>${escapeHtml(org.name)}</option>`,
    )
    .join('');
  return `
    <label class="org-select">
      <span>${escapeHtml(t('orgActiveWorkspace'))}</span>
      <select data-action="switch-org">${options}</select>
    </label>
  `;
}

function renderQueueRow(params: {
  item: QuestionQueueItem;
  canInsertIntoSurface: boolean;
  surface: PanelState['queue']['surface'];
}): string {
  const { item } = params;
  const canApprove = item.status === 'generated' && Boolean(item.answer);
  const canInsert =
    params.canInsertIntoSurface &&
    (item.status === 'approved' || item.status === 'generated') &&
    Boolean(item.answer);
  const sources = item.sources.length;
  return `
    <article class="row ${item.status}" data-item-id="${escapeHtml(item.id)}">
      <button class="row-main" data-action="select-item" data-item-id="${escapeHtml(item.id)}">
        <span class="sq ${item.status}"></span>
        <span>${escapeHtml(item.question)}</span>
      </button>
      ${renderAnswer(item)}
      <div class="row-foot">
        ${item.confidence ? confidence(item.confidence) : `<span class="status">${escapeHtml(statusLabel(item.status))}</span>`}
        ${sources > 0 ? `<span class="sources">${escapeHtml(t('sourcesCount', String(sources)))}</span>` : ''}
        <span class="spacer"></span>
        ${canApprove ? `<button class="primary xs" data-action="approve-item" data-item-id="${escapeHtml(item.id)}">${escapeHtml(t('queueApprove'))}</button>` : ''}
        ${canInsert ? renderInsertButton({ itemId: item.id, surface: params.surface }) : ''}
      </div>
    </article>
  `;
}

function renderInsertButton(params: {
  itemId: string;
  surface: PanelState['queue']['surface'];
}): string {
  const itemId = escapeHtml(params.itemId);
  if (params.surface !== 'sheets') {
    return `<button class="secondary xs" data-action="insert-item" data-item-id="${itemId}">${escapeHtml(t('queueInsert'))}</button>`;
  }
  const title = extensionConfig.googleSheetsApiEnabled
    ? t('queueInsertMappedCell')
    : t('queuePreparePaste');
  return [
    `<button class="secondary xs icon-action" data-action="insert-item"`,
    `data-item-id="${itemId}" title="${escapeHtml(title)}"`,
    `aria-label="${escapeHtml(title)}">`,
    '<span class="paste-mark" aria-hidden="true"></span></button>',
  ].join(' ');
}

function renderAnswer(item: QuestionQueueItem): string {
  if (item.status === 'generating') {
    return `<div class="answer pending">${escapeHtml(t('answerDrafting'))}</div>`;
  }
  if (item.status === 'flagged') {
    return [
      '<div class="answer flagged">',
      `<strong>${escapeHtml(t('answerNeedsReview'))}</strong>`,
      `<span>${escapeHtml(item.error ?? t('answerNoMatch'))}</span>`,
      '</div>',
    ].join('');
  }
  if (!item.answer) return '';
  return `<textarea data-answer-for="${escapeHtml(item.id)}">${escapeHtml(item.answer)}</textarea>`;
}

function renderEmptyQueue(): string {
  return `
    <div class="empty">
      <h1>${escapeHtml(t('emptyNoFields'))}</h1>
      <p>${escapeHtml(t('emptyNoFieldsBody'))}</p>
    </div>
  `;
}

function shell(body: string): string {
  return `<div class="shell">${body}</div>`;
}

function dialog(body: string): string {
  return `<div class="modal"><div class="backdrop"></div><section class="dialog">${body}</section></div>`;
}

function legendItem(status: QueueStatus, label: string): string {
  return `<span><i class="${status}"></i>${escapeHtml(label)}</span>`;
}

function confidence(level: AnswerConfidence): string {
  return `<span class="conf ${level}">${escapeHtml(level)}</span>`;
}

function statusLabel(status: QueueStatus): string {
  if (status === 'pending') return t('statusPending');
  if (status === 'generating') return t('statusDrafting');
  if (status === 'generated') return t('statusDrafted');
  if (status === 'approved') return t('statusApproved');
  if (status === 'inserted') return t('statusInserted');
  return t('statusReview');
}

function countByStatus(items: QuestionQueueItem[], status: QueueStatus): number {
  return items.filter((item) => item.status === status).length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
