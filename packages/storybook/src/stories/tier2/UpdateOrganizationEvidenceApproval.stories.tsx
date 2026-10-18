import type { Meta, StoryObj } from '@storybook/react';
import { UpdateOrganizationEvidenceApproval } from '../../../../../apps/app/src/components/forms/organization/update-organization-evidence-approval';

const meta = {
  title: 'Tier 2 — UpdateOrganizationEvidenceApproval',
  component: UpdateOrganizationEvidenceApproval,
} satisfies Meta<typeof UpdateOrganizationEvidenceApproval>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    evidenceApprovalEnabled: true,
  },
};
