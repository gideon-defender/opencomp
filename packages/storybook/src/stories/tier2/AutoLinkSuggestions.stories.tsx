import type { Meta, StoryObj } from '@storybook/react';
import { AutoLinkSuggestions } from '../../../../../apps/app/src/components/risks/treatment-plan/AutoLinkSuggestions';

const meta = {
  title: 'Tier 2 — AutoLinkSuggestions',
  component: AutoLinkSuggestions,
} satisfies Meta<typeof AutoLinkSuggestions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    orgId: 'demo_id',
    tasks: [{ id: 'demo_id_1', title: 'Example title 1', status: 'done', controls: [] }, { id: 'demo_id_2', title: 'Example title 2', status: 'done', controls: [] }, { id: 'demo_id_3', title: 'Example title 3', status: 'done', controls: [] }],
    canUpdate: true,
    onSuggest: async () => ({ runId: 'demo_id', publicAccessToken: 'Example' }),
    onApply: async () => {},
    emptyVariant: 'default',
  },
};
