import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import type { AdminTimelineTemplate } from '@/hooks/use-admin-timelines';

mockNextIntl();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    delete: vi.fn(() => Promise.resolve({})),
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
  },
}));

import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import { TemplateEditor } from './TemplateEditor';

const template: AdminTimelineTemplate = {
  id: 'tpl-1',
  frameworkId: 'fw-1',
  name: 'SOC 2',
  description: null,
  isDefault: false,
  cycleNumber: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phases: [],
};

describe('TemplateEditor delete toast flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a translated success toast after deleting a template', async () => {
    const onMutate = vi.fn();
    const onClose = vi.fn();

    render(
      <TemplateEditor open={true} onClose={onClose} template={template} onMutate={onMutate} />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'timelineTemplates.editor.delete' }),
    );

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/v1/admin/timeline-templates/tpl-1');
    });
    // mockNextIntl resolves t(key) to the key itself.
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('templateDeleted');
    expect(onMutate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders translated labels instead of hardcoded English', () => {
    render(
      <TemplateEditor open={true} onClose={vi.fn()} template={template} onMutate={vi.fn()} />,
    );

    expect(
      screen.getByText('timelineTemplates.editor.editTemplate'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('timelineTemplates.editor.templateNameLabel'),
    ).toBeInTheDocument();
  });
});
