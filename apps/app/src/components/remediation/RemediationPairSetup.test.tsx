import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemediationPairSetup } from './RemediationPairSetup';

const PAIR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
const WRONG_PAIR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Compute-us-east-1';
const GOV_ARN = 'arn:aws-us-gov:iam::123456789012:role/OpenComp-Remediator-Storage-us-gov-west-1';

function renderSetup(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <RemediationPairSetup
      awsEnvironment="aws"
      externalId="org_org_1_abc"
      regions={['us-east-1', 'eu-west-1']}
      value=""
      onChange={onChange}
      scriptEnabled
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe('RemediationPairSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes the default Storage pair for the first region', () => {
    renderSetup();

    expect(screen.getByText(/Role: OpenComp-Remediator-Storage-us-east-1/)).toBeInTheDocument();
  });

  it('shows the disabled message instead of the script before phase 1', () => {
    renderSetup({ scriptEnabled: false });

    expect(
      screen.getByText('Select an AWS environment before copying the setup script.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Copy Script/)).not.toBeInTheDocument();
  });

  it('adds a valid pair ARN into the map', () => {
    const { onChange } = renderSetup();

    fireEvent.change(screen.getByLabelText(/Pair Role ARN/), {
      target: { value: PAIR_ARN },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ 'Storage:us-east-1': PAIR_ARN }));
  });

  it('rejects an ARN from a different pair', () => {
    const { onChange } = renderSetup();

    fireEvent.change(screen.getByLabelText(/Pair Role ARN/), {
      target: { value: WRONG_PAIR_ARN },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(
      screen.getByText(
        'ARN must reference the "OpenComp-Remediator-Storage-us-east-1" role for this pair.',
      ),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a commercial ARN on a GovCloud connection', () => {
    const { onChange } = renderSetup({ awsEnvironment: 'aws-us-gov', regions: ['us-gov-west-1'] });

    fireEvent.change(screen.getByLabelText(/Pair Role ARN/), {
      target: { value: PAIR_ARN },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('ARN environment does not match this connection.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Pair Role ARN/), { target: { value: GOV_ARN } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ 'Storage:us-gov-west-1': GOV_ARN }));
  });

  it('merges into already-configured pairs and removes them', () => {
    const existing = JSON.stringify({ 'Storage:us-east-1': PAIR_ARN });
    const onChange = vi.fn();
    render(
      <RemediationPairSetup
        awsEnvironment="aws"
        externalId="org_org_1_abc"
        regions={['us-east-1', 'eu-west-1']}
        value={existing}
        onChange={onChange}
        scriptEnabled
      />,
    );

    // Configured pairs render as removable badges.
    fireEvent.click(screen.getByRole('button', { name: /Storage:us-east-1/ }));

    expect(onChange).toHaveBeenCalledWith('{}');
  });

  it('flags approval-gated classes', () => {
    renderSetup();

    fireEvent.change(screen.getByLabelText('Asset class'), {
      target: { value: 'Security-Global' },
    });

    expect(screen.getByText(/human approval required/)).toBeInTheDocument();
  });
});
