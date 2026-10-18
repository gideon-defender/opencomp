import type { Meta, StoryObj } from '@storybook/react';
import { PromptInput } from '@gideon-defender/ui/ai-elements/prompt-input';

const meta = {
  title: 'Tier 1 — PromptInput',
  component: PromptInput,
} satisfies Meta<typeof PromptInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onSubmit: () => (undefined),
    children: 'Example content',
    accept: 'Example',
    multiple: false,
    globalDrop: false,
    syncHiddenInput: false,
    maxFiles: 42,
    maxFileSize: 42,
  },
};
