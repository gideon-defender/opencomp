import type { Meta, StoryObj } from '@storybook/react';
import { UpdateOrganizationName } from '../../../../../apps/app/src/components/forms/organization/update-organization-name';

const meta = {
  title: 'Tier 2 — UpdateOrganizationName',
  component: UpdateOrganizationName,
} satisfies Meta<typeof UpdateOrganizationName>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organizationName: 'Example name',
  },
};
