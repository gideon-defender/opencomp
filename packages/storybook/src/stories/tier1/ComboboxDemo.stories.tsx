import { ComboboxDemo } from '@gideon-defender/ui/combobox';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — ComboboxDemo',
  component: ComboboxDemo,
} satisfies Meta<typeof ComboboxDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
