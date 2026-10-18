import type { Meta, StoryObj } from '@storybook/react';
import { AiWorkPreview } from '../../../../../apps/app/src/components/ai-work-preview';

const meta = {
  title: 'Tier 2 — AiWorkPreview',
  component: AiWorkPreview,
} satisfies Meta<typeof AiWorkPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
