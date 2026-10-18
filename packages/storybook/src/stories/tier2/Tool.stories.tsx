import type { Meta, StoryObj } from '@storybook/react';
import { Tool } from '../../../../../apps/app/src/components/ai-elements/tool';

const meta = {
  title: 'Tier 2 — Tool',
  component: Tool,
} satisfies Meta<typeof Tool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: false,
    children: 'Example content',
  },
};
