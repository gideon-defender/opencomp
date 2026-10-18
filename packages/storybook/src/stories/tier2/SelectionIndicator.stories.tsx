import type { Meta, StoryObj } from '@storybook/react';
import { SelectionIndicator } from '../../../../../apps/app/src/components/layout/SelectionIndicator';

const meta = {
  title: 'Tier 2 — SelectionIndicator',
  component: SelectionIndicator,
} satisfies Meta<typeof SelectionIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isSelected: true,
    variant: 'checkbox',
  },
};
