import type { Meta, StoryObj } from '@storybook/react';
import { RelinkButton } from '../../../../../apps/app/src/components/risks/treatment-plan/RelinkButton';

const meta = {
  title: 'Tier 2 — RelinkButton',
  component: RelinkButton,
} satisfies Meta<typeof RelinkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onRelink: async () => ({ runId: 'demo_id', publicAccessToken: 'Example' }),
    disabled: false,
  },
};
