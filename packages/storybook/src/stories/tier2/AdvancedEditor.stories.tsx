import type { Meta, StoryObj } from '@storybook/react';
import AdvancedEditor from '../../../../../apps/app/src/components/editor/advanced-editor';

const meta = {
  title: 'Tier 2 — AdvancedEditor',
  component: AdvancedEditor,
} satisfies Meta<typeof AdvancedEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    readOnly: false,
    placeholder: 'Example',
    saveDebounceMs: 42,
    minHeight: 'Example',
    maxHeight: 'Example',
    showToolbar: false,
  },
};
