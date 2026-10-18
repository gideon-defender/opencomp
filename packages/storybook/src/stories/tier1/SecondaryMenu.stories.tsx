import type { Meta, StoryObj } from '@storybook/react';
import { SecondaryMenu } from '@gideon-defender/ui/secondary-menu';

const meta = {
  title: 'Tier 1 — SecondaryMenu',
  component: SecondaryMenu,
} satisfies Meta<typeof SecondaryMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [{ path: 'Example 1', label: 'Example title 1' }, { path: 'Example 2', label: 'Example title 2' }, { path: 'Example 3', label: 'Example title 3' }],
    isChild: false,
    showBackButton: false,
    backButtonHref: 'https://example.com',
    backButtonLabel: 'Example title',
  },
};
