import type { Meta, StoryObj } from '@storybook/react';
import { ConnectionVariablesFields } from '../../../../../apps/app/src/components/integrations/ConnectionVariablesForm';

const meta = {
  title: 'Tier 2 — ConnectionVariablesFields',
  component: ConnectionVariablesFields,
} satisfies Meta<typeof ConnectionVariablesFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variables: [{ id: 'demo_id_1', label: 'Example title 1', type: 'string', required: true }, { id: 'demo_id_2', label: 'Example title 2', type: 'string', required: true }, { id: 'demo_id_3', label: 'Example title 3', type: 'string', required: true }],
    variableValues: {  },
    setVariableValues: () => {},
    dynamicOptions: {  },
    loadingOptions: {  },
    fetchOptions: () => {},
  },
};
