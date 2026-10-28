import { Toast } from '@gideon-defender/ui/toast';
import type { Meta, StoryObj } from '@storybook/react';
import { withToast } from '../../mocks/decorators';

const meta = {
  title: 'Tier 1 — Toast',
  component: Toast,
  decorators: [withToast],
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
    variant: 'progress',
  },
};
