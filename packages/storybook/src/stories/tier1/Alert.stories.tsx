import type { Meta, StoryObj } from '@storybook/react';
import { Alert } from '@gideon-defender/ui/alert';

const meta = {
  title: 'Tier 1 — Alert',
  component: Alert,
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    variant: 'default',
  },
};
