import type { Meta, StoryObj } from '@storybook/react';
import { ConnectionVariableMultiSelect } from '../../../../../apps/app/src/components/integrations/ConnectionVariableMultiSelect';

const meta = {
  title: 'Tier 2 — ConnectionVariableMultiSelect',
  component: ConnectionVariableMultiSelect,
} satisfies Meta<typeof ConnectionVariableMultiSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variable: { id: 'demo_id', label: 'Example title', type: 'string', required: true },
    options: [{ value: 'Example 1', label: 'Example title 1' }, { value: 'Example 2', label: 'Example title 2' }, { value: 'Example 3', label: 'Example title 3' }],
    isLoadingOptions: true,
    value: 'Example',
    onChange: () => {},
    onLoadOptions: () => {},
  },
};
