import type { Meta, StoryObj } from '@storybook/react';
import { ManageIntegrationDialog } from '../../../../../apps/app/src/components/integrations/ManageIntegrationDialog';

const meta = {
  title: 'Tier 2 — ManageIntegrationDialog',
  component: ManageIntegrationDialog,
} satisfies Meta<typeof ManageIntegrationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    connectionId: 'demo_id',
    integrationId: 'demo_id',
    integrationName: 'Example name',
    integrationLogoUrl: 'https://example.com',
    configureOnly: false,
  },
};
