import type { Meta, StoryObj } from '@storybook/react';
import { withPanelGroup } from '../../mocks/decorators';
import { ResizableHandle } from '@gideon-defender/ui/resizable';

const meta = {
  title: 'Tier 1 — ResizableHandle',
  component: ResizableHandle,
  decorators: [withPanelGroup],
} satisfies Meta<typeof ResizableHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    withHandle: false,
  },
};
