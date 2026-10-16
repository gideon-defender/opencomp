import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleForm } from './RoleForm';

mockNextIntl();
const caller = vi.hoisted((): { permissions: Record<string, string[]> } => ({ permissions: {} }));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => caller }));

function selectWrite(label: string) {
  const row = screen.getByText(label).closest('[class*="grid"]');
  if (!(row instanceof HTMLElement)) throw new Error(`Missing row: ${label}`);
  fireEvent.click(within(row).getAllByRole('radio')[2]);
}

describe('RoleForm grant limits with the real permission matrix', () => {
  beforeEach(() => {
    caller.permissions = BUILT_IN_ROLE_PERMISSIONS.admin;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['admin', 'owner'])('submits only %s permissions for Write all', async (role) => {
    caller.permissions = BUILT_IN_ROLE_PERMISSIONS[role];
    const handleSubmit = vi.fn();
    render(<RoleForm onSubmit={handleSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Role Name'), { target: { value: 'Lead' } });
    selectWrite('matrix.selectAll');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledOnce());
    const permissions: Record<string, string[]> = handleSubmit.mock.calls[0][0].permissions;
    expect(permissions.finding).toEqual(['read', 'update']);
    expect(permissions.organization).toEqual(caller.permissions.organization);
    for (const [resource, actions] of Object.entries(permissions)) {
      expect(actions.every((action) => caller.permissions[resource]?.includes(action))).toBe(true);
    }
  });

  it('lets an admin grant organization updates without organization deletion', async () => {
    const handleSubmit = vi.fn();
    render(<RoleForm onSubmit={handleSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Role Name'), { target: { value: 'Lead' } });
    selectWrite('matrix.organization');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Lead',
        permissions: { organization: ['read', 'update'] },
        obligations: {},
      }),
    );
  });

  it('disables grants outside a read-only caller scope', () => {
    caller.permissions = { control: ['read'] };
    render(<RoleForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'matrix.control' });
    expect(within(group).getByRole('radio', { name: 'matrix.read' })).toBeEnabled();
    expect(within(group).getByRole('radio', { name: 'matrix.write' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'matrix.employeeCompliance' })).toBeDisabled();
  });
});
