import type { Meta, StoryObj } from '@storybook/react';
import { TriggerProvider } from '../../../../../apps/app/src/components/trigger-provider';

const meta = {
  title: 'Tier 2 — TriggerProvider',
  component: TriggerProvider,
} satisfies Meta<typeof TriggerProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    accessToken: 'Example',
    children: 'Example content',
  },
};
