import { Conversation } from '@gideon-defender/ui/ai-elements/conversation';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Conversation',
  component: Conversation,
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example',
  },
};
