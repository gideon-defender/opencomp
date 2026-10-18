import type { Meta, StoryObj } from '@storybook/react';
import { LockPill } from '../../../../../apps/app/src/components/marketing-empty-state/LockPill';

const meta = {
  title: 'Tier 2 — LockPill',
  component: LockPill,
} satisfies Meta<typeof LockPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Example title',
  },
};
