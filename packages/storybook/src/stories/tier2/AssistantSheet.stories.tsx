import type { Meta, StoryObj } from '@storybook/react';
import { AssistantSheet } from '../../../../../apps/app/src/components/sheets/assistant-sheet';

const meta = {
  title: 'Tier 2 — AssistantSheet',
  component: AssistantSheet,
  parameters: {
    searchParams: { assistant: 'true' },
  },
} satisfies Meta<typeof AssistantSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
