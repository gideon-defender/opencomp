import type { Meta, StoryObj } from '@storybook/react';
import { AppOnboarding } from '../../../../../apps/app/src/components/app-onboarding';

const meta = {
  title: 'Tier 2 — AppOnboarding',
  component: AppOnboarding,
} satisfies Meta<typeof AppOnboarding>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    description: 'Example description',
    imageSrcLight: 'Example',
    imageSrcDark: 'Example',
    imageAlt: 'Example',
    cta: 'Example',
    sheetName: 'Example name',
    href: 'https://example.com',
    ctaDisabled: false,
    ctaTooltip: 'Example',
  },
};
