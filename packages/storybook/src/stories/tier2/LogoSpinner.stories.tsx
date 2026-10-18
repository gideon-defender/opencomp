import type { Meta, StoryObj } from '@storybook/react';
import { LogoSpinner } from '../../../../../apps/app/src/components/logo-spinner';

const meta = {
  title: 'Tier 2 — LogoSpinner',
  component: LogoSpinner,
} satisfies Meta<typeof LogoSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    size: 42,
    raceColor: '#1d4e3f',
    isDisabled: false,
    children: 'Example content',
  },
};
