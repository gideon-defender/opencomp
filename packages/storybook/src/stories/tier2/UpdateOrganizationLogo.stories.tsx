import type { Meta, StoryObj } from '@storybook/react';
import { UpdateOrganizationLogo } from '../../../../../apps/app/src/components/forms/organization/update-organization-logo';

const meta = {
  title: 'Tier 2 — UpdateOrganizationLogo',
  component: UpdateOrganizationLogo,
} satisfies Meta<typeof UpdateOrganizationLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    currentLogoUrl: 'https://example.com',
  },
};
