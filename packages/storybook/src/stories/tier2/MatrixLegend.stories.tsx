import type { Meta, StoryObj } from '@storybook/react';
import { MatrixLegend } from '../../../../../apps/app/src/components/risks/charts/MatrixLegend';

const meta = {
  title: 'Tier 2 — MatrixLegend',
  component: MatrixLegend,
} satisfies Meta<typeof MatrixLegend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
