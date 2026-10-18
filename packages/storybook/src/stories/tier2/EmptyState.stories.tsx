import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from '../../../../../apps/app/src/components/risks/treatment-plan/AutoLinkSuggestions.parts';

const meta = {
  title: 'Tier 2 — EmptyState',
  component: EmptyState,
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    canUpdate: true,
    submitting: true,
    onSuggest: () => {},
    variant: 'default',
  },
};
