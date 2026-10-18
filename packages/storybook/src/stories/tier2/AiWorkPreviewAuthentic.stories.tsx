import type { Meta, StoryObj } from '@storybook/react';
import { AiWorkPreviewAuthentic } from '../../../../../apps/app/src/components/ai-work-preview-authentic';

const meta = {
  title: 'Tier 2 — AiWorkPreviewAuthentic',
  component: AiWorkPreviewAuthentic,
} satisfies Meta<typeof AiWorkPreviewAuthentic>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
