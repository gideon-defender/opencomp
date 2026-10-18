import type { Meta, StoryObj } from '@storybook/react';
import { Card } from '@gideon-defender/ui/card';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import { Progress } from '@gideon-defender/ui/progress';

const meta = {
  title: 'Tier 3 — Overview Dashboard',
  parameters: {
    layout: 'padded',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Compliance progress</h3>
          <Badge>In progress</Badge>
        </div>
        <Progress value={64} />
        <p className="text-sm text-muted-foreground">
          SOC 2 Type 2 — 64% across 42 controls
        </p>
      </Card>
      <Card className="space-y-2 p-4">
        <h3 className="font-semibold">To-dos</h3>
        <div className="text-sm">
          <p>1 policy draft awaiting review</p>
          <p>3 incomplete tasks</p>
        </div>
        <Button size="sm">Continue</Button>
      </Card>
    </div>
  ),
};
