import type { Meta, StoryObj } from '@storybook/react';
import { Message } from '../../../../../apps/app/src/components/ai-elements/message';

const meta = {
  title: 'Tier 2 — Message',
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
