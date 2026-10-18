import type { Meta, StoryObj } from '@storybook/react';
import { MiniDataStream } from '../../../../../apps/app/src/components/mini-data-stream';

const meta = {
  title: 'Tier 2 — MiniDataStream',
  component: MiniDataStream,
} satisfies Meta<typeof MiniDataStream>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    taskType: 'control',
    itemTitle: 'Example title',
  },
};
