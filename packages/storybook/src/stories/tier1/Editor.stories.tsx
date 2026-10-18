import type { Meta, StoryObj } from '@storybook/react';
import { Editor } from '@gideon-defender/ui/editor/index';

const meta = {
  title: 'Tier 1 — Editor',
  component: Editor,
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    readOnly: false,
    placeholder: 'Example',
    saveDebounceMs: 42,
    showSaveStatus: false,
    showWordCount: false,
    showToolbar: false,
    minHeight: 'Example',
    maxHeight: 'Example',
  },
};
