import { ButtonGroup } from '@gideon-defender/ui/button-group';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — ButtonGroup',
  component: ButtonGroup,
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    orientation: 'horizontal',
  },
};
