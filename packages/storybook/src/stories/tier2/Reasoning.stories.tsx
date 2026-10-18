import type { Meta, StoryObj } from '@storybook/react';
import { Reasoning } from '../../../../../apps/app/src/components/ai-elements/reasoning';

const meta = {
  title: 'Tier 2 — Reasoning',
  component: Reasoning,
} satisfies Meta<typeof Reasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: false,
    children: 'Example content',
    isStreaming: false,
    duration: 42,
  },
};
