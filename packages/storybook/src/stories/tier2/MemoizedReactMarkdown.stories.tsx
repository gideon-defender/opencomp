import type { Meta, StoryObj } from '@storybook/react';
import { MemoizedReactMarkdown } from '../../../../../apps/app/src/components/markdown';

const meta = {
  title: 'Tier 2 — MemoizedReactMarkdown',
  component: MemoizedReactMarkdown,
} satisfies Meta<typeof MemoizedReactMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example',
  },
};
