import type { Meta, StoryObj } from '@storybook/react';
import { ChatUser } from '../../../../../apps/app/src/components/chat-user';

const meta = {
  title: 'Tier 2 — ChatUser',
  component: ChatUser,
} satisfies Meta<typeof ChatUser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    avatarUrl: 'https://example.com',
    fullName: 'Example name',
    date: '2026-01-01T00:00:00.000Z',
  },
};
