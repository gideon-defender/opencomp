import { TimeRangeInput } from '@gideon-defender/ui/time-range-input';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — TimeRangeInput',
  component: TimeRangeInput,
} satisfies Meta<typeof TimeRangeInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: { start: 'Example', end: 'Example' },
    onChange: () => {},
  },
};
