import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from '@gideon-defender/ui/checkbox';

const meta = {
  title: 'Tier 1 — Checkbox',
  component: Checkbox,
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
