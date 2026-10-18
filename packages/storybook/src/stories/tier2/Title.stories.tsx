import type { Meta, StoryObj } from '@storybook/react';
import { Title } from '../../../../../apps/app/src/components/title';

const meta = {
  title: 'Tier 2 — Title',
  component: Title,
} satisfies Meta<typeof Title>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    href: 'https://example.com',
  },
};
