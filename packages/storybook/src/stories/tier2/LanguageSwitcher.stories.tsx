import type { Meta, StoryObj } from '@storybook/react';
import { LanguageSwitcher } from '../../../../../apps/app/src/components/language-switcher';

const meta = {
  title: 'Tier 2 — LanguageSwitcher',
  component: LanguageSwitcher,
} satisfies Meta<typeof LanguageSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    size: 'default',
  },
};
