import type { Meta, StoryObj } from '@storybook/react';
import { ComboboxDropdown } from '@gideon-defender/ui/combobox-dropdown';

const meta = {
  title: 'Tier 1 — ComboboxDropdown',
  component: ComboboxDropdown,
} satisfies Meta<typeof ComboboxDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [],
    onSelect: () => {},
    searchPlaceholder: 'Example',
    disabled: false,
    headless: false,
  },
};
