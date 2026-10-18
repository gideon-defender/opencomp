import type { Meta, StoryObj } from '@storybook/react';
import { InputGroup } from '@gideon-defender/ui/input-group';

const meta = {
  title: 'Tier 1 — InputGroup',
  component: InputGroup,
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
