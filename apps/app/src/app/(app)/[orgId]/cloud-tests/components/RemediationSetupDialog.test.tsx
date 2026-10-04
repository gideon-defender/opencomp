import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({ get: mockGet, put: mockPut }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
}));

import { RemediationSetupDialog } from './RemediationSetupDialog';

mockNextIntl();

const PAIR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
const WRONG_PAIR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Compute-us-east-1';

function mockConnection(metadata: Record<string, unknown>) {
  mockGet.mockResolvedValue({ data: { metadata }, error: null });
  mockPut.mockResolvedValue({ data: {}, error: null });
}

function renderDialog() {
  const onSaved = vi.fn();
  const utils = render(
    <RemediationSetupDialog
      open
      onOpenChange={() => {}}
      orgId="org_1"
      connectionId="conn-1"
      onSaved={onSaved}
    />,
  );
  return { ...utils, onSaved };
}

async function openArnInput() {
  return screen.findByLabelText(/Remediation Role ARN/);
}

describe('RemediationSetupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection({ regions: ['us-east-1'], remediationRoles: '{}' });
  });

  it('loads regions and routes the default Storage pair', async () => {
    renderDialog();

    expect(await openArnInput()).toHaveAttribute(
      'placeholder',
      `arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1`,
    );
    expect(screen.getByText(/Role: OpenComp-Remediator-Storage-us-east-1/)).toBeInTheDocument();
  });

  it('keeps typed input across re-renders instead of refetch-resetting', async () => {
    const { rerender } = renderDialog();
    const input = await openArnInput();

    fireEvent.change(input, { target: { value: PAIR_ARN } });
    rerender(
      <RemediationSetupDialog
        open
        onOpenChange={() => {}}
        orgId="org_1"
        connectionId="conn-1"
        onSaved={() => {}}
      />,
    );

    // The load effect must run once per open, not once per render: a second
    // fetch would reset the region and wipe the typed ARN.
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue(PAIR_ARN)).toBeInTheDocument();
  });

  it('rejects an ARN minted for another pair', async () => {
    renderDialog();
    const input = await openArnInput();

    fireEvent.change(input, { target: { value: WRONG_PAIR_ARN } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'ARN must reference the "OpenComp-Remediator-Storage-us-east-1" role for this pair.',
      ),
    ).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('rejects a malformed ARN before any network call', async () => {
    renderDialog();
    const input = await openArnInput();

    fireEvent.change(input, { target: { value: 'not-an-arn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Invalid ARN format. Expected an AWS IAM role ARN.'),
    ).toBeInTheDocument();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('saves the merged map without dropping existing pairs', async () => {
    mockConnection({
      regions: ['us-east-1'],
      remediationRoles: JSON.stringify({
        'Data:us-east-1': 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Data-us-east-1',
      }),
    });
    const { onSaved } = renderDialog();
    const input = await openArnInput();

    fireEvent.change(input, { target: { value: PAIR_ARN } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    const [, body] = mockPut.mock.calls[0] as [
      string,
      { credentials: { remediationRoles: string } },
    ];
    const saved = JSON.parse(body.credentials.remediationRoles) as Record<string, string>;
    expect(saved['Storage:us-east-1']).toBe(PAIR_ARN);
    expect(saved['Data:us-east-1']).toBe(
      'arn:aws:iam::123456789012:role/OpenComp-Remediator-Data-us-east-1',
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('pins Security-Global to us-east-1 with no region selection', async () => {
    renderDialog();
    await openArnInput();

    fireEvent.change(screen.getByLabelText('Asset class'), {
      target: { value: 'Security-Global' },
    });

    expect(
      screen.getByLabelText(/Remediation Role ARN \(Security-Global:us-east-1\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Role: OpenComp-Remediator-Security-Global/)).toBeInTheDocument();
  });
});
