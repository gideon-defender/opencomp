import type { Meta, StoryObj } from '@storybook/react';
import { DescriptionEditor } from '../../../../../apps/app/src/components/risks/treatment-plan/DescriptionEditor';

const meta = {
  title: 'Tier 2 — DescriptionEditor',
  component: DescriptionEditor,
} satisfies Meta<typeof DescriptionEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'Example',
    onSave: async () => {},
    regenerating: false,
    disabled: false,
  },
};
