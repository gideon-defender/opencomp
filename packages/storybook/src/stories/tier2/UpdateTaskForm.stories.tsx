import type { Meta, StoryObj } from '@storybook/react';
import { UpdateTaskForm } from '../../../../../apps/app/src/components/forms/risks/task/update-task-form';

const meta = {
  title: 'Tier 2 — UpdateTaskForm',
  component: UpdateTaskForm,
} satisfies Meta<typeof UpdateTaskForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    task: { id: 'demo_id', organizationId: 'demo_id', description: 'Example description', assigneeId: 'demo_id', createdAt: new Date('2026-01-01T00:00:00.000Z'), department: 'Example', title: 'Example title', status: 'done', order: 42, frequency: 'monthly', reviewDate: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), archivedAt: new Date('2026-01-01T00:00:00.000Z'), approverId: 'demo_id', embeddingHash: 'Example', automationStatus: 'AUTOMATED', integrationScheduleFrequency: 'monthly', integrationLastRunAt: new Date('2026-01-01T00:00:00.000Z'), lastCompletedAt: new Date('2026-01-01T00:00:00.000Z'), taskTemplateId: 'demo_id', approvedAt: new Date('2026-01-01T00:00:00.000Z'), previousStatus: 'done', notRelevantJustification: 'Example' },
    users: [{ name: 'Example name 1', id: 'demo_id_1', createdAt: new Date('2026-01-01T00:00:00.000Z'), image: 'Example 1', email: 'person1@example.com', updatedAt: new Date('2026-01-01T00:00:00.000Z'), emailVerified: true, lastLogin: new Date('2026-01-01T00:00:00.000Z'), emailNotificationsUnsubscribed: true, emailPreferences: 'person1@example.com', banned: false, banReason: 'Example 1', banExpires: new Date('2026-01-01T00:00:00.000Z'), oidcSub: 'Example 1', tenantId: 'demo_id_1', oidcTenantId: 'demo_id_1' }, { name: 'Example name 2', id: 'demo_id_2', createdAt: new Date('2026-01-01T00:00:00.000Z'), image: 'Example 2', email: 'person2@example.com', updatedAt: new Date('2026-01-01T00:00:00.000Z'), emailVerified: true, lastLogin: new Date('2026-01-01T00:00:00.000Z'), emailNotificationsUnsubscribed: true, emailPreferences: 'person2@example.com', banned: false, banReason: 'Example 2', banExpires: new Date('2026-01-01T00:00:00.000Z'), oidcSub: 'Example 2', tenantId: 'demo_id_2', oidcTenantId: 'demo_id_2' }, { name: 'Example name 3', id: 'demo_id_3', createdAt: new Date('2026-01-01T00:00:00.000Z'), image: 'Example 3', email: 'person3@example.com', updatedAt: new Date('2026-01-01T00:00:00.000Z'), emailVerified: true, lastLogin: new Date('2026-01-01T00:00:00.000Z'), emailNotificationsUnsubscribed: true, emailPreferences: 'person3@example.com', banned: false, banReason: 'Example 3', banExpires: new Date('2026-01-01T00:00:00.000Z'), oidcSub: 'Example 3', tenantId: 'demo_id_3', oidcTenantId: 'demo_id_3' }],
  },
};
