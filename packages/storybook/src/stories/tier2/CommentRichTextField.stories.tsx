import type { Meta, StoryObj } from '@storybook/react';
import { CommentRichTextField } from '../../../../../apps/app/src/components/comments/CommentRichTextField';

const meta = {
  title: 'Tier 2 — CommentRichTextField',
  component: CommentRichTextField,
} satisfies Meta<typeof CommentRichTextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: {  },
    onChange: () => {},
    members: [{ id: 'demo_id_1', name: 'Example name 1', email: 'person1@example.com' }, { id: 'demo_id_2', name: 'Example name 2', email: 'person2@example.com' }, { id: 'demo_id_3', name: 'Example name 3', email: 'person3@example.com' }],
    disabled: false,
    placeholder: 'Example',
  },
};
