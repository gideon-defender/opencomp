import type { Meta, StoryObj } from '@storybook/react';
import PageWithBreadcrumb from '../../../../../apps/app/src/components/pages/PageWithBreadcrumb';

const meta = {
  title: 'Tier 2 — PageWithBreadcrumb',
  component: PageWithBreadcrumb,
} satisfies Meta<typeof PageWithBreadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    breadcrumbs: [{ label: 'Example title 1' }, { label: 'Example title 2' }, { label: 'Example title 3' }],
    maxItems: 42,
    maxLabelLength: 42,
  },
};
