import { Switch } from '@gideon-defender/ui/switch';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Switch',
  component: Switch,
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
