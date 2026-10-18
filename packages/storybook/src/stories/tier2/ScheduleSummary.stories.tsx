import type { Meta, StoryObj } from '@storybook/react';
import { ScheduleSummary } from '../../../../../apps/app/src/components/schedule-summary';

const meta = {
  title: 'Tier 2 — ScheduleSummary',
  component: ScheduleSummary,
} satisfies Meta<typeof ScheduleSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    scheduleFrequency: 'monthly',
    lastRunAt: '2026-01-01T00:00:00.000Z',
  },
};
