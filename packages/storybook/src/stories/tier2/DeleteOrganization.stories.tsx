import type { Meta, StoryObj } from '@storybook/react';
import { DeleteOrganization } from '../../../../../apps/app/src/components/forms/organization/delete-organization';

const meta = {
  title: 'Tier 2 — DeleteOrganization',
  component: DeleteOrganization,
} satisfies Meta<typeof DeleteOrganization>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organizationId: 'demo_id',
    isOwner: true,
  },
};
