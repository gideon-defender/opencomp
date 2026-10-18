import type { Meta, StoryObj } from '@storybook/react';
import { ScrollArea } from '@gideon-defender/ui/scroll-area';

const meta = {
  title: 'Tier 1 — ScrollArea',
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    hideScrollbar: false,
  },
};
