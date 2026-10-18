import type { Meta, StoryObj } from '@storybook/react';
import { CopyButton } from '@gideon-defender/ui/copy-button';

const meta = {
  title: 'Tier 1 — CopyButton',
  component: CopyButton,
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'Example',
    children: 'Example content',
  },
};
