import { Separator } from '@gideon-defender/ui/separator';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Separator',
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
