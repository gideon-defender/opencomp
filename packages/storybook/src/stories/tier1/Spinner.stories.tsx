import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from '@gideon-defender/ui/spinner';

const meta = {
  title: 'Tier 1 — Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    size: 42,
    label: 'Example title',
    children: 'Example content',
  },
};
