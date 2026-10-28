import { ButtonIcon } from '@gideon-defender/ui/button-icon';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — ButtonIcon',
  component: ButtonIcon,
} satisfies Meta<typeof ButtonIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    isLoading: false,
  },
};
