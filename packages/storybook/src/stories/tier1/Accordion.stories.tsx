import type { Meta, StoryObj } from '@storybook/react';
import { Accordion } from '@gideon-defender/ui/accordion';

const meta = {
  title: 'Tier 1 — Accordion',
  component: Accordion,
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    type: 'single',
    children: 'Example content',
  },
};
