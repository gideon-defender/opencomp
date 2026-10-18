import type { Meta, StoryObj } from '@storybook/react';
import { Calendar } from '@gideon-defender/ui/calendar';

const meta = {
  title: 'Tier 1 — Calendar',
  component: Calendar,
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
