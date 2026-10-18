import type { Meta, StoryObj } from '@storybook/react';
import { OidcSignIn } from '../../../../../apps/app/src/components/oidc-sign-in';

const meta = {
  title: 'Tier 2 — OidcSignIn',
  component: OidcSignIn,
} satisfies Meta<typeof OidcSignIn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    inviteCode: 'Example',
    redirectTo: 'Example',
  },
};
