import type { Meta, StoryObj } from '@storybook/react';
import { Conversation } from '../../../../../apps/app/src/components/ai-elements/conversation';

const meta = {
  title: 'Tier 2 — Conversation',
  component: Conversation,
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example',
  },
};
