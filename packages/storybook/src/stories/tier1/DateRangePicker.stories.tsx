import { DateRangePicker } from '@gideon-defender/ui/date-range-picker';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — DateRangePicker',
  component: DateRangePicker,
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    range: { from: new Date('2026-01-01T00:00:00.000Z') },
    className: {},
    onSelect: () => {},
    placeholder: 'Example',
    disabled: false,
  },
};
