import type { Meta, StoryObj } from '@storybook/react';
import { DiffViewer } from '@gideon-defender/ui/diff-viewer';

const meta = {
  title: 'Tier 1 — DiffViewer',
  component: DiffViewer,
} satisfies Meta<typeof DiffViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    patch: 'diff --git a/policy.md b/policy.md\nindex 1111111..2222222 100644\n--- a/policy.md\n+++ b/policy.md\n@@ -1,3 +1,3 @@\n # Access Control Policy\n-Reviewed annually.\n+Reviewed quarterly.\n Owner: Security team.',
  },
};
