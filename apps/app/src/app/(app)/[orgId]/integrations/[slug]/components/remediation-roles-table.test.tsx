import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemediationRolesTable } from './remediation-roles-table';

vi.mock('@/components/integrations/CloudShellSetup', () => ({
  CloudShellSetup: () => <div data-testid="cloud-shell-setup" />,
}));

vi.mock('@/components/integrations/CredentialInput', () => ({
  CredentialInput: ({
    field,
    value,
    onChange,
  }: {
    field: { id: string; placeholder?: string };
    value: unknown;
    onChange: (value: unknown) => void;
  }) => (
    <input
      aria-label={field.id}
      placeholder={field.placeholder}
      value={Array.isArray(value) ? value.join(',') : ((value as string) ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

mockNextIntl();

const PAIR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
const WRONG_PAIR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Compute-us-east-1';

function renderTable(initialMap: Record<string, string> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <RemediationRolesTable
      regions={['us-east-1']}
      initialMap={initialMap}
      externalId="org_1"
      awsEnvironment="aws"
      accountId="123456789012"
      saving={false}
      onSave={onSave}
    />,
  );
  return { onSave };
}

describe('RemediationRolesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one row per region x class plus the pinned global row', () => {
    renderTable();

    expect(screen.getByText('OpenComp-Remediator-Storage-us-east-1')).toBeInTheDocument();
    expect(screen.getByText('OpenComp-Remediator-Compute-us-east-1')).toBeInTheDocument();
    expect(screen.getByText('OpenComp-Remediator-Network-us-east-1')).toBeInTheDocument();
    expect(screen.getByText('OpenComp-Remediator-Data-us-east-1')).toBeInTheDocument();
    expect(screen.getByText('OpenComp-Remediator-Security-Global')).toBeInTheDocument();
  });

  it('prefills configured ARNs from the initial map', () => {
    renderTable({ 'Storage:us-east-1': PAIR_ARN });

    expect(screen.getByDisplayValue(PAIR_ARN)).toBeInTheDocument();
  });

  it('blocks invalid ARNs client-side without saving', async () => {
    const { onSave } = renderTable();

    fireEvent.change(
      screen.getByPlaceholderText(
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      ),
      { target: { value: 'not-an-arn' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'awsSettings.save' }));

    expect(await screen.findByText('awsSettings.pairInvalidArn')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a valid ARN from another pair (exact-pair binding)', async () => {
    const { onSave } = renderTable();

    fireEvent.change(
      screen.getByPlaceholderText(
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      ),
      { target: { value: WRONG_PAIR_ARN } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'awsSettings.save' }));

    expect(await screen.findByText('awsSettings.pairRoleMismatch')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('drops orphan keys for removed regions on save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RemediationRolesTable
        regions={['us-east-1']}
        initialMap={{
          'Storage:us-east-1': PAIR_ARN,
          'Storage:eu-west-1':
            'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-eu-west-1',
        }}
        externalId="org_1"
        awsEnvironment="aws"
        accountId="123456789012"
        saving={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'awsSettings.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(JSON.stringify({ 'Storage:us-east-1': PAIR_ARN }));
  });

  it('warns on invalid stored regions instead of crashing', () => {
    render(
      <RemediationRolesTable
        regions={['us-east-1', 'BAD;REGION']}
        initialMap={{}}
        externalId="org_1"
        awsEnvironment="aws"
        accountId="123456789012"
        saving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('awsSettings.pairInvalidRegions')).toBeInTheDocument();
    expect(screen.getByText('OpenComp-Remediator-Storage-us-east-1')).toBeInTheDocument();
  });

  it('serializes the draft map to onSave', async () => {
    const { onSave } = renderTable();

    fireEvent.change(
      screen.getByPlaceholderText(
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      ),
      { target: { value: `  ${PAIR_ARN}  ` } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'awsSettings.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(JSON.stringify({ 'Storage:us-east-1': PAIR_ARN }));
  });

  it('keeps unsaved edits when the parent re-renders with an equal map', () => {
    const { rerender } = render(
      <RemediationRolesTable
        regions={['us-east-1']}
        initialMap={{}}
        externalId="org_1"
        awsEnvironment="aws"
        accountId="123456789012"
        saving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // The parent derives initialMap via parseRemediationRolesMap on every
    // render — a fresh but equal object. Typing must survive that.
    fireEvent.change(
      screen.getByPlaceholderText(
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      ),
      { target: { value: PAIR_ARN } },
    );
    rerender(
      <RemediationRolesTable
        regions={['us-east-1']}
        initialMap={{}}
        externalId="org_1"
        awsEnvironment="aws"
        accountId="123456789012"
        saving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByDisplayValue(PAIR_ARN)).toBeInTheDocument();
  });

  it('resyncs the draft when the saved map actually changes', () => {
    const { rerender } = render(
      <RemediationRolesTable
        regions={['us-east-1']}
        initialMap={{}}
        externalId="org_1"
        awsEnvironment="aws"
        accountId="123456789012"
        saving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    rerender(
      <RemediationRolesTable
        regions={['us-east-1']}
        initialMap={{ 'Storage:us-east-1': PAIR_ARN }}
        externalId="org_1"
        awsEnvironment="aws"
        accountId="123456789012"
        saving={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByDisplayValue(PAIR_ARN)).toBeInTheDocument();
  });
});
