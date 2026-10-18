import type { Meta, StoryObj } from '@storybook/react';
import { FileCard } from '../../../../../apps/app/src/components/upload/FileCard';

const meta = {
  title: 'Tier 2 — FileCard',
  component: FileCard,
} satisfies Meta<typeof FileCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    url: 'https://example.com',
    previewState: { url: 'https://example.com', isLoading: false },
    isDialogOpen: true,
    onOpenChange: () => {},
    onPreviewClick: async () => {},
    onDelete: async () => {},
  },
};
