import type { Meta, StoryObj } from '@storybook/react';
import PageCore from '../../../../../apps/app/src/components/pages/PageCore.tsx';

const meta = {
  title: 'Tier 2 — PageCore',
  component: PageCore,
} satisfies Meta<typeof PageCore>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
