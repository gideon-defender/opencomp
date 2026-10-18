import type { Meta, StoryObj } from '@storybook/react';
import { CodeBlock } from '../../../../../apps/app/src/components/ai-elements/code-block';

const meta = {
  title: 'Tier 2 — CodeBlock',
  component: CodeBlock,
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    code: 'Example',
    language: '1c',
    children: 'Example content',
    showLineNumbers: false,
  },
};
