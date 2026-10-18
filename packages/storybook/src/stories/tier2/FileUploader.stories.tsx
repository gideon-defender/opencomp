import type { Meta, StoryObj } from '@storybook/react';
import { FileUploader } from '../../../../../apps/app/src/components/file-uploader';

const meta = {
  title: 'Tier 2 — FileUploader',
  component: FileUploader,
} satisfies Meta<typeof FileUploader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    maxSize: 42,
    maxFileCount: 42,
    multiple: false,
    disabled: false,
    children: 'Example content',
  },
};
