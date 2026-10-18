import type { Meta, StoryObj } from '@storybook/react';
import { CredentialInput } from '../../../../../apps/app/src/components/integrations/CredentialInput';

const meta = {
  title: 'Tier 2 — CredentialInput',
  component: CredentialInput,
} satisfies Meta<typeof CredentialInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    field: { id: 'demo_id', label: 'Example title', type: 'number', required: true },
    value: 'Example',
    onChange: () => {},
    disabled: false,
  },
};
