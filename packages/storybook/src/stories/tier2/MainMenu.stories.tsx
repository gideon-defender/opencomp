import type { Meta, StoryObj } from '@storybook/react';
import { MainMenu } from '../../../../../apps/app/src/components/main-menu';

const meta = {
  title: 'Tier 2 — MainMenu',
  component: MainMenu,
} satisfies Meta<typeof MainMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organizationId: 'demo_id',
    isCollapsed: false,
    isQuestionnaireEnabled: false,
    isOnlyAuditor: false,
  },
};
