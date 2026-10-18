import type { Meta, StoryObj } from '@storybook/react';
import { RadioGroup } from '@gideon-defender/ui/radio-group';

const meta = {
  title: 'Tier 1 — RadioGroup',
  component: RadioGroup,
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
