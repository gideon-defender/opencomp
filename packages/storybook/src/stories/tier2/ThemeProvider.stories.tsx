import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider } from '../../../../../apps/app/src/components/theme-provider';

const meta = {
  title: 'Tier 2 — ThemeProvider',
  component: ThemeProvider,
} satisfies Meta<typeof ThemeProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
