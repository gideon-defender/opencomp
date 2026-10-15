import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import type { Member, User } from '@db';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmployeeDetails } from './EmployeeDetails';

mockNextIntl();

const employee = {
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: 'org_1',
  role: 'employee',
  createdAt: new Date(),
  department: 'engineering',
  jobTitle: 'Engineer',
  isActive: true,
  onboardDate: null,
  offboardDate: null,
  user: {
    id: 'usr_1',
    name: 'Manoj Madhavan',
    email: 'manoj.madhavan@plurilock.com',
  },
} as unknown as Member & { user: User };

describe('EmployeeDetails read-only Gideon-synced profile', () => {
  it('renders profile values with no editable fields or save action', () => {
    render(<EmployeeDetails employee={employee} />);

    expect(screen.getByText('Manoj Madhavan')).toBeInTheDocument();
    expect(screen.getByText('manoj.madhavan@plurilock.com')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('engineering')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'employeeDetails.save' })).not.toBeInTheDocument();
  });

  it('shows the Gideon sync notice', () => {
    render(<EmployeeDetails employee={employee} />);

    expect(screen.getByText(/sync from Gideon/i)).toBeInTheDocument();
  });

  it('renders the synced status label', () => {
    render(<EmployeeDetails employee={employee} />);

    expect(screen.getByText('employeeDetails.statusActive')).toBeInTheDocument();
  });
});
