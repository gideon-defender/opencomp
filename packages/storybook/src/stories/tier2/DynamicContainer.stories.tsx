import type { Meta, StoryObj } from '@storybook/react';
import { DynamicContainer } from '../../../../../apps/app/src/components/data-table/dynamic-container';

const meta = {
  title: 'Tier 2 — DynamicContainer',
  component: DynamicContainer,
} satisfies Meta<typeof DynamicContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    width: false,
    height: false,
    children: 'Example content',
  },
};
