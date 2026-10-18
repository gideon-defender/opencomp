import type { Meta, StoryObj } from '@storybook/react';
import { ThemeSwitch } from '../../../../../apps/app/src/components/theme-switch';

const meta = {
  title: 'Tier 2 — ThemeSwitch',
  component: ThemeSwitch,
} satisfies Meta<typeof ThemeSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
