import type { Meta, StoryObj } from '@storybook/react';
import { UpdateTaskOverviewForm } from '../../../../../apps/app/src/components/forms/risks/task/update-task-overview-form';

const meta = {
  title: 'Tier 2 — UpdateTaskOverviewForm',
  component: UpdateTaskOverviewForm,
  parameters: {
    searchParams: { 'task-update-overview-sheet': 'true' },
  },
} satisfies Meta<typeof UpdateTaskOverviewForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    task: { id: 'demo_id', organizationId: 'demo_id', description: 'Example description', assigneeId: 'demo_id', createdAt: new Date('2026-01-01T00:00:00.000Z'), department: 'Example', title: 'Example title', status: 'done', order: 42, frequency: 'monthly', reviewDate: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), archivedAt: new Date('2026-01-01T00:00:00.000Z'), approverId: 'demo_id', embeddingHash: 'Example', automationStatus: 'AUTOMATED', integrationScheduleFrequency: 'monthly', integrationLastRunAt: new Date('2026-01-01T00:00:00.000Z'), lastCompletedAt: new Date('2026-01-01T00:00:00.000Z'), taskTemplateId: 'demo_id', approvedAt: new Date('2026-01-01T00:00:00.000Z'), previousStatus: 'done', notRelevantJustification: 'Example' },
  },
};
