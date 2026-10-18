import type { Meta, StoryObj } from '@storybook/react';
import { Tool } from '@gideon-defender/ui/ai-elements/tool';

const meta = {
  title: 'Tier 1 — Tool',
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
