import type { Meta, StoryObj } from '@storybook/react';
import Loader from '../../../../../apps/app/src/components/ui/loader';

const meta = {
  title: 'Tier 2 — Loader',
  component: Loader,
} satisfies Meta<typeof Loader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
