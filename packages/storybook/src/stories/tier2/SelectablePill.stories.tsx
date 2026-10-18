import type { Meta, StoryObj } from '@storybook/react';
import { SelectablePill } from '../../../../../apps/app/src/components/selectable-pill';

const meta = {
  title: 'Tier 2 — SelectablePill',
  component: SelectablePill,
} satisfies Meta<typeof SelectablePill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Example title',
    isSelected: true,
    onSelectionChange: () => {},
    disabled: false,
    showIcon: false,
  },
};
