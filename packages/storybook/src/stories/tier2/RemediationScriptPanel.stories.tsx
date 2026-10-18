import type { Meta, StoryObj } from '@storybook/react';
import { RemediationScriptPanel } from '../../../../../apps/app/src/components/remediation/RemediationScriptPanel';

const meta = {
  title: 'Tier 2 — RemediationScriptPanel',
  component: RemediationScriptPanel,
} satisfies Meta<typeof RemediationScriptPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    script: 'Example',
    cloudShellUrl: 'https://example.com',
  },
};
