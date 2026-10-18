import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedLayout } from '../../../../../apps/app/src/components/animated-layout';

const meta = {
  title: 'Tier 2 — AnimatedLayout',
  component: AnimatedLayout,
} satisfies Meta<typeof AnimatedLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    sidebar: 'Example content',
    isCollapsed: true,
    blurred: false,
  },
};
