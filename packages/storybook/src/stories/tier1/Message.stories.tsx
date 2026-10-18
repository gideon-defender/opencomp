import type { Meta, StoryObj } from '@storybook/react';
import { Message } from '@gideon-defender/ui/ai-elements/message';

const meta = {
  title: 'Tier 1 — Message',
  component: Message,
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    from: 'system',
    children: 'Example content',
  },
};
