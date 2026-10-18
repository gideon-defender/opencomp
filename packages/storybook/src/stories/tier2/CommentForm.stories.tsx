import type { Meta, StoryObj } from '@storybook/react';
import { CommentForm } from '../../../../../apps/app/src/components/comments/CommentForm';

const meta = {
  title: 'Tier 2 — CommentForm',
  component: CommentForm,
} satisfies Meta<typeof CommentForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entityId: 'demo_id',
    entityType: 'policy',
    mentionResource: 'Example',
    organizationId: 'demo_id',
  },
};
