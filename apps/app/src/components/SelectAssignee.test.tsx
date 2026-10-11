import type { Member, User } from '@db';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectAssignee } from './SelectAssignee';

vi.mock('@/utils/auth-client', () => ({
  authClient: { useActiveMember: () => ({ data: null }) },
}));

// Radix Select relies on browser APIs absent from jsdom.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Assignee = Member & { user: User };

function member(id: string, name: string, email: string): Assignee {
  return {
    id,
    userId: `usr_${id}`,
    organizationId: 'org_1',
    role: 'employee',
    user: { id: `usr_${id}`, name, email, image: null },
  } as unknown as Assignee;
}

const assignees = () => [
  member('mem_zoe', 'Zoe', 'zoe@example.com'),
  member('mem_amy', 'Amy', 'amy@example.com'),
];

describe('SelectAssignee', () => {
  it('does not mutate the assignees prop when sorting', () => {
    const input = assignees();
    const orderBefore = input.map((m) => m.id);

    render(
      <SelectAssignee
        assigneeId={null}
        assignees={input}
        onAssigneeChange={vi.fn()}
        withTitle={false}
      />,
    );

    expect(input.map((m) => m.id)).toEqual(orderBefore);
  });

  it('shows the selected assignee in the trigger', () => {
    render(
      <SelectAssignee
        assigneeId="mem_amy"
        assignees={assignees()}
        onAssigneeChange={vi.fn()}
        withTitle={false}
      />,
    );

    expect(screen.getByText('Amy')).toBeInTheDocument();
  });

  it('lists assignees sorted by name', async () => {
    const user = userEvent.setup();
    render(
      <SelectAssignee
        assigneeId={null}
        assignees={assignees()}
        onAssigneeChange={vi.fn()}
        withTitle={false}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    const options = await screen.findAllByRole('option');

    // 'Unassigned' stays first; members follow in name order. Removing the
    // sort would list Zoe before Amy and fail this assertion.
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Unassigned'),
      expect.stringContaining('Amy'),
      expect.stringContaining('Zoe'),
    ]);
  });
});
