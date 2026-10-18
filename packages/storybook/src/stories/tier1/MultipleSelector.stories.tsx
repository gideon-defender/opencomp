import type { Meta, StoryObj } from '@storybook/react';
import MultipleSelector from '@gideon-defender/ui/multiple-selector';

const meta = {
  title: 'Tier 1 — MultipleSelector',
  component: MultipleSelector,
} satisfies Meta<typeof MultipleSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'Example',
    delay: 42,
    triggerSearchOnFocus: false,
    maxSelected: 42,
    hidePlaceholderWhenSelected: false,
    disabled: false,
    groupBy: 'Example',
    badgeClassName: 'Example name',
    selectFirstItem: false,
    creatable: false,
    hideClearAllButton: false,
  },
};
