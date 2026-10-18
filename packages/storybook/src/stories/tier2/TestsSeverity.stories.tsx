import type { Meta, StoryObj } from '@storybook/react';
import { TestsSeverity } from '../../../../../apps/app/src/components/tests/charts/tests-severity';

const meta = {
  title: 'Tier 2 — TestsSeverity',
  component: TestsSeverity,
} satisfies Meta<typeof TestsSeverity>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    totalTests: 42,
    infoSeverityTests: 42,
    lowSeverityTests: 42,
    mediumSeverityTests: 42,
    highSeverityTests: 42,
    criticalSeverityTests: 42,
  },
};
