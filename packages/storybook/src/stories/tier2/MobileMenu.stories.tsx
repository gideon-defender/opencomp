import type { Meta, StoryObj } from '@storybook/react';
import { MobileMenu } from '../../../../../apps/app/src/components/mobile-menu';

const meta = {
  title: 'Tier 2 — MobileMenu',
  component: MobileMenu,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
} satisfies Meta<typeof MobileMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organization: { id: 'demo_id', name: 'Example name' },
    isCollapsed: false,
    organizationId: 'demo_id',
    isQuestionnaireEnabled: false,
  },
};
