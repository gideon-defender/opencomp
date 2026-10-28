import { Toggle } from '@gideon-defender/ui/toggle';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Toggle',
  component: Toggle,
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    variant: 'default',
    size: 'default',
  },
};
