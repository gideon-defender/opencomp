import type { Meta, StoryObj } from '@storybook/react';
import { CloudShellSetup } from '../../../../../apps/app/src/components/integrations/CloudShellSetup';

const meta = {
  title: 'Tier 2 — CloudShellSetup',
  component: CloudShellSetup,
} satisfies Meta<typeof CloudShellSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    script: 'Example',
    externalId: 'demo_id',
    title: 'Example title',
    subtitle: 'Example title',
    footnote: 'Example',
    cloudShellUrl: 'https://example.com',
    disabled: false,
    disabledMessage: 'Example',
  },
};
