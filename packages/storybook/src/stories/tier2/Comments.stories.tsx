import type { Meta, StoryObj } from '@storybook/react';
import { Comments } from '../../../../../apps/app/src/components/comments/Comments';

const meta = {
  title: 'Tier 2 — Comments',
  component: Comments,
} satisfies Meta<typeof Comments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entityId: 'demo_id',
    entityType: 'policy',
    mentionResource: 'Example',
    organizationId: 'demo_id',
    readOnly: false,
  },
};
