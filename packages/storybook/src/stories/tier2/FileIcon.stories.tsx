import type { Meta, StoryObj } from '@storybook/react';
import { FileIcon } from '../../../../../apps/app/src/components/upload/FileIcon';

const meta = {
  title: 'Tier 2 — FileIcon',
  component: FileIcon,
} satisfies Meta<typeof FileIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    fileName: 'Example name',
  },
};
