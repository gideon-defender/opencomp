import type { Meta, StoryObj } from '@storybook/react';
import { OrganizationBadge } from '../../../../../apps/app/src/components/organization-badge';

const meta = {
  title: 'Tier 2 — OrganizationBadge',
  component: OrganizationBadge,
} satisfies Meta<typeof OrganizationBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organization: { id: 'demo_id', name: 'Example name' },
    logoUrl: 'https://example.com',
    isCollapsed: false,
    maxWidth: 'Example',
  },
};
