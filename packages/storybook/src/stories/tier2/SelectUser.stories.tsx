import type { Meta, StoryObj } from '@storybook/react';
import { withSelect } from '../../mocks/decorators';
import { SelectUser } from '../../../../../apps/app/src/components/select-user';

const meta = {
  title: 'Tier 2 — SelectUser',
  component: SelectUser,
  decorators: [withSelect],
} satisfies Meta<typeof SelectUser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    users: [{ id: 'demo_id_1', name: 'Example name 1' }, { id: 'demo_id_2', name: 'Example name 2' }, { id: 'demo_id_3', name: 'Example name 3' }],
    isLoading: false,
    onSelect: () => {},
    selectedId: 'demo_id',
  },
};
