import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@gideon-defender/ui/button';

const meta = {
  title: 'Tier 1 — Button',
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    variant: 'link',
    size: 'default',
  },
};
