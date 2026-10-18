import type { Meta, StoryObj } from '@storybook/react';
import { SelectPills } from '@gideon-defender/ui/select-pills';

const meta = {
  title: 'Tier 1 — SelectPills',
  component: SelectPills,
} satisfies Meta<typeof SelectPills>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [{ name: 'Example name 1' }, { name: 'Example name 2' }, { name: 'Example name 3' }],
    defaultValue: ['Example 1', 'Example 2', 'Example 3'],
    value: ['Example 1', 'Example 2', 'Example 3'],
    placeholder: 'Example',
    disabled: false,
  },
};
