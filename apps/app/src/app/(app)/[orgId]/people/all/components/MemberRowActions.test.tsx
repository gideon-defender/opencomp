import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemberRow } from './MemberRow';
import type { MemberWithUser } from './TeamMembers';

vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: 'org_123' }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const member = {
  id: 'mem_1',
  role: 'employee',
  isActive: true,
  deactivated: false,
  fleetDmLabelId: 'label_1',
  user: { name: 'Jane Doe', email: 'jane@example.com', image: null },
} as unknown as MemberWithUser;

describe('MemberRow device removal', () => {
  it('keeps device removal available through the real menu and confirmation dialog', async () => {
    const user = userEvent.setup();
    const handleRemoveDevice = vi.fn().mockResolvedValue(undefined);
    render(
      <table>
        <tbody>
          <MemberRow
            member={member}
            isCurrentUserOwner
            deviceStatus="compliant"
            onRemoveDevice={handleRemoveDevice}
          />
        </tbody>
      </table>,
    );

    await user.click(screen.getByRole('button', { name: 'Member device actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit Roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove Member' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Remove Device' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(handleRemoveDevice).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));
    expect(handleRemoveDevice).toHaveBeenCalledExactlyOnceWith('mem_1');
  });
});
