import type { Meta, StoryObj } from '@storybook/react';
import { StatusDate } from '../../../../../apps/app/src/components/status-date';

const meta = {
  title: 'Tier 2 — StatusDate',
  component: StatusDate,
} satisfies Meta<typeof StatusDate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    date: new Date('2026-01-01T00:00:00.000Z'),
    isClosed: false,
  },
};
