import type { Meta, StoryObj } from '@storybook/react';
import { FrameworkPill } from '../../../../../apps/app/src/components/framework-pill';

const meta = {
  title: 'Tier 2 — FrameworkPill',
  component: FrameworkPill,
} satisfies Meta<typeof FrameworkPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    framework: { name: 'Example name', id: 'demo_id', version: 'Example' },
    isSelected: true,
    onSelectionChange: () => {},
  },
};
