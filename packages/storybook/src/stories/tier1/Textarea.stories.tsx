import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from '@gideon-defender/ui/textarea';

const meta = {
  title: 'Tier 1 — Textarea',
  component: Textarea,
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
