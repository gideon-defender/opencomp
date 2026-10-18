import type { Meta, StoryObj } from '@storybook/react';
import { withSonnerToast } from '../../mocks/decorators';
import { Toaster } from '@gideon-defender/ui/sonner';

const meta = {
  title: 'Tier 1 — Toaster',
  component: Toaster,
  decorators: [withSonnerToast],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
