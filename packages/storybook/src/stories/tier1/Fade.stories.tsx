import type { Meta, StoryObj } from '@storybook/react';
import { withCanvas } from '../../mocks/decorators';
import { Fade } from '@gideon-defender/ui/diff/blur-fade';

const meta = {
  title: 'Tier 1 — Fade',
  component: Fade,
  decorators: [withCanvas],
} satisfies Meta<typeof Fade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    side: 'bottom',
    background: 'Example',
    stop: 'Example',
    blur: 'Example',
    debug: false,
  },
};
