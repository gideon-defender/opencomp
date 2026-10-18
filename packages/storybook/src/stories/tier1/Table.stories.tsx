import type { Meta, StoryObj } from '@storybook/react';
import { Table } from '@gideon-defender/ui/table';

const meta = {
  title: 'Tier 1 — Table',
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: <tbody><tr><td>Example content</td></tr></tbody>,
  },
};
