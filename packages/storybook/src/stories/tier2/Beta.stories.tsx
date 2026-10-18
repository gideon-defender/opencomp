import type { Meta, StoryObj } from '@storybook/react';
import { Beta } from '../../../../../apps/app/src/components/beta';

const meta = {
  title: 'Tier 2 — Beta',
  component: Beta,
} satisfies Meta<typeof Beta>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
