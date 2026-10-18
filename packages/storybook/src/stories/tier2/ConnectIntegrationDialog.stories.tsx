import type { Meta, StoryObj } from '@storybook/react';
import { ConnectIntegrationDialog } from '../../../../../apps/app/src/components/integrations/ConnectIntegrationDialog';

const meta = {
  title: 'Tier 2 — ConnectIntegrationDialog',
  component: ConnectIntegrationDialog,
} satisfies Meta<typeof ConnectIntegrationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    integrationId: 'demo_id',
    integrationName: 'Example name',
    integrationLogoUrl: 'https://example.com',
    initialView: 'form',
  },
};
