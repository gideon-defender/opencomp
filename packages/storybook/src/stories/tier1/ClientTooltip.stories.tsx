import type { Meta, StoryObj } from '@storybook/react';
import { ClientTooltip } from '@gideon-defender/ui/chart-tooltip';

const meta = {
  title: 'Tier 1 — ClientTooltip',
  component: ClientTooltip,
} satisfies Meta<typeof ClientTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
