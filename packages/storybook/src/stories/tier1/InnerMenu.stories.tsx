import type { Meta, StoryObj } from '@storybook/react';
import { InnerMenu } from '@gideon-defender/ui/inner-menu';

const meta = {
  title: 'Tier 1 — InnerMenu',
  component: InnerMenu,
} satisfies Meta<typeof InnerMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    previous: 'Example',
  },
};
