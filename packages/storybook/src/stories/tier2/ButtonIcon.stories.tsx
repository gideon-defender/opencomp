import type { Meta, StoryObj } from '@storybook/react';
import { ButtonIcon } from '../../../../../apps/app/src/components/ui/button-icon';

const meta = {
  title: 'Tier 2 — ButtonIcon',
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
