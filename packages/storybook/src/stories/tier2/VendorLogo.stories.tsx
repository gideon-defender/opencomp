import type { Meta, StoryObj } from '@storybook/react';
import { VendorLogo } from '../../../../../apps/app/src/components/VendorLogo';

const meta = {
  title: 'Tier 2 — VendorLogo',
  component: VendorLogo,
} satisfies Meta<typeof VendorLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hostname: 'example.com',
    size: 42,
  },
};
