import type { Meta, StoryObj } from '@storybook/react';
import { AutoLinkButton } from '../../../../../apps/app/src/components/risks/treatment-plan/AutoLinkButton';

const meta = {
  title: 'Tier 2 — AutoLinkButton',
  component: AutoLinkButton,
} satisfies Meta<typeof AutoLinkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hasDescription: true,
    onAutoLink: async () => ({ runId: 'demo_id', publicAccessToken: 'Example' }),
    disabled: false,
  },
};
