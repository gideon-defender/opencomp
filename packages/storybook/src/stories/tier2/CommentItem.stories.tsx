import type { Meta, StoryObj } from '@storybook/react';
import { CommentItem } from '../../../../../apps/app/src/components/comments/CommentItem';

const meta = {
  title: 'Tier 2 — CommentItem',
  component: CommentItem,
} satisfies Meta<typeof CommentItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    comment: { id: 'demo_id', content: 'Example description', author: { id: 'demo_id', name: 'Example name', email: 'person@example.com', image: 'Example', deactivated: true }, attachments: [{ id: 'demo_id_1', name: 'Example name 1', type: 'Example 1', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'demo_id_2', name: 'Example name 2', type: 'Example 2', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'demo_id_3', name: 'Example name 3', type: 'Example 3', createdAt: '2026-01-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z' },
    refreshComments: () => {},
    entityType: 'Example',
    readOnly: false,
  },
};
