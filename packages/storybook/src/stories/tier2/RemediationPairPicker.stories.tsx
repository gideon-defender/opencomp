import type { Meta, StoryObj } from '@storybook/react';
import { RemediationPairPicker } from '../../../../../apps/app/src/components/remediation/RemediationPairPicker';

const meta = {
  title: 'Tier 2 — RemediationPairPicker',
  component: RemediationPairPicker,
} satisfies Meta<typeof RemediationPairPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    assetClass: 'Storage',
    region: 'Example',
    regions: ['Example 1', 'Example 2', 'Example 3'],
    onAssetClassChange: () => {},
    onRegionChange: () => {},
  },
};
