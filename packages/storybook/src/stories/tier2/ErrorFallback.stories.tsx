import type { Meta, StoryObj } from '@storybook/react';
import { ErrorFallback } from '../../../../../apps/app/src/components/error-fallback';

const meta = {
  title: 'Tier 2 — ErrorFallback',
  component: ErrorFallback,
} satisfies Meta<typeof ErrorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
