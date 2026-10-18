import type { Meta, StoryObj } from '@storybook/react';
import { AssistantButton } from '../../../../../apps/app/src/components/ai/chat-button';

const meta = {
  title: 'Tier 2 — AssistantButton',
  component: AssistantButton,
} satisfies Meta<typeof AssistantButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
