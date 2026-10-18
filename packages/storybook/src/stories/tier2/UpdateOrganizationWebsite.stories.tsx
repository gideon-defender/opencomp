import type { Meta, StoryObj } from '@storybook/react';
import { UpdateOrganizationWebsite } from '../../../../../apps/app/src/components/forms/organization/update-organization-website';

const meta = {
  title: 'Tier 2 — UpdateOrganizationWebsite',
  component: UpdateOrganizationWebsite,
} satisfies Meta<typeof UpdateOrganizationWebsite>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organizationWebsite: 'Example',
  },
};
