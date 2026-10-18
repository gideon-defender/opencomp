import type { Meta, StoryObj } from '@storybook/react';
import { SubmitButton } from '@gideon-defender/ui/submit-button';

const meta = {
  title: 'Tier 1 — SubmitButton',
  component: SubmitButton,
} satisfies Meta<typeof SubmitButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    isSubmitting: true,
    disabled: false,
    variant: 'link',
    size: 'default',
  },
};
