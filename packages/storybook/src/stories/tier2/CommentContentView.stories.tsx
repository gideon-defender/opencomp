import type { Meta, StoryObj } from '@storybook/react';
import { CommentContentView } from '../../../../../apps/app/src/components/comments/CommentContentView';

const meta = {
  title: 'Tier 2 — CommentContentView',
  component: CommentContentView,
} satisfies Meta<typeof CommentContentView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    content: 'Example description',
  },
};
