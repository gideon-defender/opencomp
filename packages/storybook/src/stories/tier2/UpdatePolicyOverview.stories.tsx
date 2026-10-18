import type { Meta, StoryObj } from '@storybook/react';
import { UpdatePolicyOverview } from '../../../../../apps/app/src/components/forms/policies/policy-overview';

const meta = {
  title: 'Tier 2 — UpdatePolicyOverview',
  component: UpdatePolicyOverview,
} satisfies Meta<typeof UpdatePolicyOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    policy: { name: 'Example name', id: 'demo_id', organizationId: 'demo_id', description: 'Example description', assigneeId: 'demo_id', createdAt: new Date('2026-01-01T00:00:00.000Z'), department: 'Example', content: ['Example description 1', 'Example description 2', 'Example description 3'], status: 'draft', visibility: 'ALL', draftContent: ['Example description 1', 'Example description 2', 'Example description 3'], frequency: 'monthly', isRequiredToSign: true, signedBy: ['Example 1', 'Example 2', 'Example 3'], reviewDate: new Date('2026-01-01T00:00:00.000Z'), isArchived: false, displayFormat: 'EDITOR', pdfUrl: 'https://example.com', visibleToDepartments: ['Example 1', 'Example 2', 'Example 3'], updatedAt: new Date('2026-01-01T00:00:00.000Z'), lastArchivedAt: new Date('2026-01-01T00:00:00.000Z'), lastPublishedAt: new Date('2026-01-01T00:00:00.000Z'), archivedAt: new Date('2026-01-01T00:00:00.000Z'), approverId: 'demo_id', policyTemplateId: 'demo_id', currentVersionId: 'demo_id', pendingVersionId: 'demo_id' },
  },
};
