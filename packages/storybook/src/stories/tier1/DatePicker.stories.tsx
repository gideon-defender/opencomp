import { DatePicker } from '@gideon-defender/ui/date-picker';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — DatePicker',
  component: DatePicker,
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
