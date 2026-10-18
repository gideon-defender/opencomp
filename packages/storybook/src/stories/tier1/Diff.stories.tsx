import type { Meta, StoryObj } from '@storybook/react';
import { Diff } from '@gideon-defender/ui/diff/index';

const meta = {
  title: 'Tier 1 — Diff',
  component: Diff,
} satisfies Meta<typeof Diff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    type: 'add',
    hunks: [{ type: 'hunk', lines: [], content: 'Example description 1', oldStart: 42, newStart: 42, oldLines: 42, newLines: 42 }, { type: 'hunk', lines: [], content: 'Example description 2', oldStart: 28, newStart: 28, oldLines: 28, newLines: 28 }, { type: 'hunk', lines: [], content: 'Example description 3', oldStart: 15, newStart: 15, oldLines: 15, newLines: 15 }],
    fileName: 'Example name',
    language: 'Example',
    children: <tr><td>Example content</td></tr>,
  },
};
