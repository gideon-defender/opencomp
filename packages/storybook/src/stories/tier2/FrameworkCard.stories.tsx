import type { Meta, StoryObj } from '@storybook/react';
import { FrameworkCard } from '../../../../../apps/app/src/components/framework-card';

const meta = {
  title: 'Tier 2 — FrameworkCard',
  component: FrameworkCard,
} satisfies Meta<typeof FrameworkCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    framework: { name: 'Example name', id: 'demo_id', description: 'Example description', visible: true, version: 'Example' },
    isSelected: true,
    onSelectionChange: () => {},
  },
};
