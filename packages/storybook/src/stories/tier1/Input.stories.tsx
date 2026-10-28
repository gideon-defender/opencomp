import { Input } from '@gideon-defender/ui/input';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Input',
  component: Input,
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    prefix: 'Example',
  },
};
