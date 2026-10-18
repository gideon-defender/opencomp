import type { Meta, StoryObj } from '@storybook/react';
import { AxisTooltip } from '../../../../../apps/app/src/components/risks/charts/AxisTooltip';

const meta = {
  title: 'Tier 2 — AxisTooltip',
  component: AxisTooltip,
} satisfies Meta<typeof AxisTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Example content',
    definition: 'Example',
  },
};
