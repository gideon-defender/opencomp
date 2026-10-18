import type { Meta, StoryObj } from '@storybook/react';
import { OAuthReconnect } from '../../../../../apps/app/src/components/integrations/OAuthReconnect';

const meta = {
  title: 'Tier 2 — OAuthReconnect',
  component: OAuthReconnect,
} satisfies Meta<typeof OAuthReconnect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    connectionId: 'demo_id',
    providerSlug: 'example-slug',
    providerName: 'Example name',
    errorMessage: 'Example',
  },
};
