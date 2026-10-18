import type { Meta, StoryObj } from '@storybook/react';
import { PolicyEditor } from '../../../../../apps/app/src/components/editor/policy-editor';

const meta = {
  title: 'Tier 2 — PolicyEditor',
  component: PolicyEditor,
} satisfies Meta<typeof PolicyEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    content: [{  }, {  }, {  }],
    readOnly: false,
    minHeight: 'Example',
    maxHeight: 'Example',
    showToolbar: false,
  },
};
