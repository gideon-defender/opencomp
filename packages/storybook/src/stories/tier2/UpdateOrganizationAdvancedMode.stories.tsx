import type { Meta, StoryObj } from '@storybook/react';
import { UpdateOrganizationAdvancedMode } from '../../../../../apps/app/src/components/forms/organization/update-organization-advanced-mode';

const meta = {
  title: 'Tier 2 — UpdateOrganizationAdvancedMode',
  component: UpdateOrganizationAdvancedMode,
} satisfies Meta<typeof UpdateOrganizationAdvancedMode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    advancedModeEnabled: true,
  },
};
