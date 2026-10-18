import type { Meta, StoryObj } from '@storybook/react';
import { CommentList } from '../../../../../apps/app/src/components/comments/CommentList';

const meta = {
  title: 'Tier 2 — CommentList',
  component: CommentList,
} satisfies Meta<typeof CommentList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    comments: [{ id: 'demo_id_1', content: 'Example description 1', author: { id: 'demo_id_1', name: 'Example name 1', email: 'person1@example.com', image: 'Example 1', deactivated: true }, attachments: [], createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'demo_id_2', content: 'Example description 2', author: { id: 'demo_id_2', name: 'Example name 2', email: 'person2@example.com', image: 'Example 2', deactivated: true }, attachments: [], createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'demo_id_3', content: 'Example description 3', author: { id: 'demo_id_3', name: 'Example name 3', email: 'person3@example.com', image: 'Example 3', deactivated: true }, attachments: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    refreshComments: () => {},
    entityType: 'Example',
    readOnly: false,
  },
};
