import type { Meta, StoryObj } from '@storybook/react';
import { Breadcrumb } from '@gideon-defender/ui/breadcrumb';

const meta = {
  title: 'Tier 1 — Breadcrumb',
  component: Breadcrumb,
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
