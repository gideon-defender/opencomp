import type { Meta, StoryObj } from '@storybook/react';
import { VendorNewsLoadingPlaceholder } from '../../../../../apps/app/src/components/vendor-risk-assessment/VendorNewsLoadingPlaceholder';

const meta = {
  title: 'Tier 2 — VendorNewsLoadingPlaceholder',
  component: VendorNewsLoadingPlaceholder,
} satisfies Meta<typeof VendorNewsLoadingPlaceholder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
