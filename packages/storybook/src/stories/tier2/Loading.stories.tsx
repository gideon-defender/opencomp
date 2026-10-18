import type { Meta, StoryObj } from '@storybook/react';
import { Loading } from '../../../../../apps/app/src/components/frameworks/loading';

const meta = {
  title: 'Tier 2 — Loading',
  component: Loading,
} satisfies Meta<typeof Loading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isEmpty: true,
    amount: 42,
  },
};
