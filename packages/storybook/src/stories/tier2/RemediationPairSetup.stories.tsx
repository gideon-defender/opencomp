import type { Meta, StoryObj } from '@storybook/react';
import { RemediationPairSetup } from '../../../../../apps/app/src/components/remediation/RemediationPairSetup';

const meta = {
  title: 'Tier 2 — RemediationPairSetup',
  component: RemediationPairSetup,
} satisfies Meta<typeof RemediationPairSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    awsEnvironment: 'aws',
    externalId: 'demo_id',
    regions: ['Example 1', 'Example 2', 'Example 3'],
    value: 'Example',
    onChange: () => {},
    scriptEnabled: true,
    disabledMessage: 'Example',
  },
};
