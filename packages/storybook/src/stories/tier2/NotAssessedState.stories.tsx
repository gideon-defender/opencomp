import type { Meta, StoryObj } from '@storybook/react';
import { NotAssessedState } from '../../../../../apps/app/src/components/risks/treatment-plan/NotAssessedState';

const meta = {
  title: 'Tier 2 — NotAssessedState',
  component: NotAssessedState,
} satisfies Meta<typeof NotAssessedState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onAssess: () => (undefined),
    disabled: false,
    description: 'Example description',
    headline: 'Example',
    ctaLabel: 'Example title',
  },
};
