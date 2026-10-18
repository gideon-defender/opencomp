import type { Meta, StoryObj } from '@storybook/react';
import { Can } from '../../../../../apps/app/src/components/can';

const meta = {
  title: 'Tier 2 — Can',
  component: Can,
} satisfies Meta<typeof Can>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    permission: 'risk:update',
    resource: 'Example',
    action: 'Example',
  },
};
