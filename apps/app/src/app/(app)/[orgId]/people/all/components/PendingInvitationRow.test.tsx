import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PendingInvitationRow } from './PendingInvitationRow';

const baseInvitation = {
  id: 'inv_1',
  email: 'invited@example.com',
  role: 'employee',
  organizationId: 'org_123',
  createdAt: new Date(),
} as unknown as Parameters<typeof PendingInvitationRow>[0]['invitation'];

describe('PendingInvitationRow (historical OpenComp invitations, read-only)', () => {
  it('renders invitation details with no action buttons', () => {
    render(
      <table>
        <tbody>
          <PendingInvitationRow invitation={baseInvitation} requirementColumnCount={1} />
        </tbody>
      </table>,
    );

    expect(screen.getByText('invited@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('renders one dash per requirement column plus the actions dash', () => {
    render(
      <table>
        <tbody>
          <PendingInvitationRow invitation={baseInvitation} requirementColumnCount={3} />
        </tbody>
      </table>,
    );

    // 2 static dashes (onboarded/offboarded) + 3 requirement dashes + 1 actions dash
    expect(screen.getAllByText('—').length).toBe(6);
  });
});
