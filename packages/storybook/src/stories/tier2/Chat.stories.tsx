import type { Meta, StoryObj } from '@storybook/react';
import Chat from '../../../../../apps/app/src/components/ai/chat';

const meta = {
  title: 'Tier 2 — Chat',
  component: Chat,
} satisfies Meta<typeof Chat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
