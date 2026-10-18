import type { Meta, StoryObj } from '@storybook/react';
import { StrategyPicker } from '../../../../../apps/app/src/components/risks/treatment-plan/StrategyPicker';

const meta = {
  title: 'Tier 2 — StrategyPicker',
  component: StrategyPicker,
} satisfies Meta<typeof StrategyPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'accept',
    onChange: () => {},
    disabled: false,
  },
};
