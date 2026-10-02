import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PermissionErrorPanel } from './PermissionErrorPanel';

describe('PermissionErrorPanel provider detection', () => {
  it('detects Azure errors referencing management.azure.com as a host token', () => {
    render(
      <PermissionErrorPanel
        error="AuthorizationFailed: Permission denied for scope https://management.azure.com/subscriptions/x"
        fixScript="az role assignment create"
      />,
    );
    expect(screen.getByText(/role assignment changes in azure may take/i)).toBeInTheDocument();
    expect(screen.queryByText(/iam changes in gcp may take/i)).not.toBeInTheDocument();
  });

  it('does not treat a lookalike hostname suffix as Azure', () => {
    render(
      <PermissionErrorPanel
        error="not authorized to perform: sts:AssumeRole because token came from management.azure.com.evil.com"
        apiCalls={['sts:AssumeRole']}
      />,
    );
    expect(screen.getByText(/propagate in aws/i)).toBeInTheDocument();
    expect(screen.queryByText(/role assignment changes in azure/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/iam changes in gcp/i)).not.toBeInTheDocument();
  });

  it('detects GCP errors referencing googleapis.com as a host token', () => {
    render(
      <PermissionErrorPanel
        error="Permission denied when calling googleapis.com endpoints"
        fixScript="gcloud projects add-iam-policy-binding"
      />,
    );
    expect(screen.getByText(/iam changes in gcp may take/i)).toBeInTheDocument();
    expect(screen.queryByText(/role assignment changes in azure/i)).not.toBeInTheDocument();
  });

  it('does not treat a lookalike hostname suffix as GCP', () => {
    render(
      <PermissionErrorPanel
        error="AccessDenied: request to storage.googleapis.com.attacker.example rejected"
        apiCalls={['s3:ListBucket']}
      />,
    );
    expect(screen.getByText(/propagate in aws/i)).toBeInTheDocument();
    expect(screen.queryByText(/iam changes in gcp may take/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/role assignment changes in azure/i)).not.toBeInTheDocument();
  });
});

describe('PermissionErrorPanel denylist guidance', () => {
  it('shows manual-review guidance instead of hiding the script when all actions are blocked', () => {
    render(
      <PermissionErrorPanel
        error="not authorized to perform: iam:PassRole"
        missingActions={['iam:PassRole']}
      />,
    );
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toMatch(/manual review/i);
    expect(pre?.textContent).toContain('iam:PassRole');
  });

  it('omits blocked actions from the granted script but keeps grantable ones', () => {
    render(
      <PermissionErrorPanel
        error="not authorized"
        missingActions={['s3:PutBucketEncryption', 'iam:PassRole']}
      />,
    );
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('s3:PutBucketEncryption');
    expect(pre?.textContent).not.toContain('"iam:PassRole"');
    expect(pre?.textContent).toMatch(/WARNING/i);
  });

  it('parses hyphenated service names from the error when no actions are provided', () => {
    render(
      <PermissionErrorPanel error="not authorized to perform: cognito-idp:DescribeUserPool with an explicit deny" />,
    );
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('cognito-idp:DescribeUserPool');
  });

  it('prefers the service-linked-role command over backend scripts', () => {
    render(
      <PermissionErrorPanel
        error="Config needs its service-linked role before recording: not authorized to perform iam:CreateServiceLinkedRole"
        fixScript="aws iam put-role-policy --role-name OpenComp-Remediator --policy-name OpenComp-AutoFix"
        missingActions={['iam:CreateServiceLinkedRole']}
      />,
    );
    expect(screen.getByText(/missing service-linked role/i)).toBeInTheDocument();
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain(
      'aws iam create-service-linked-role --aws-service-name config.amazonaws.com',
    );
    expect(pre?.textContent).not.toContain('put-role-policy');
  });

  it('never renders the AWS service-linked-role command for Azure errors', () => {
    render(
      <PermissionErrorPanel
        provider="azure"
        error="AuthorizationFailed: config needs its service-linked role before recording"
      />,
    );
    expect(screen.queryByText(/missing service-linked role/i)).not.toBeInTheDocument();
    expect(document.querySelector('pre')?.textContent ?? '').not.toContain(
      'create-service-linked-role',
    );
  });

  it('labels guidance-only scripts as manual review instead of a run command', () => {
    render(
      <PermissionErrorPanel
        error="not authorized to perform: iam:PassRole"
        missingActions={['iam:PassRole']}
      />,
    );
    expect(screen.getByText(/manual review required/i)).toBeInTheDocument();
    expect(screen.queryByText(/to add the permission/i)).not.toBeInTheDocument();
    expect(screen.getByText(/copy details/i)).toBeInTheDocument();
  });

  it('keeps the run-command header for executable scripts', () => {
    render(
      <PermissionErrorPanel error="not authorized" missingActions={['s3:PutBucketEncryption']} />,
    );
    expect(screen.getByText(/to add the permission/i)).toBeInTheDocument();
    expect(screen.queryByText(/manual review required/i)).not.toBeInTheDocument();
  });

  it('excludes backend-reported blocked actions from the Required banner', () => {
    // Backend blocked-only shape: nothing grantable, WARNING-only script,
    // blocked action named in the error text.
    render(
      <PermissionErrorPanel
        error="not authorized to perform: iam:PassRole on resource"
        missingActions={[]}
        fixScript="# WARNING: 1 required permission(s) need manual review and were NOT granted: iam:PassRole"
        blockedPermissions={['iam:PassRole']}
      />,
    );
    expect(screen.getByText(/manual review required/i)).toBeInTheDocument();
    expect(screen.queryByText(/Required:/)).not.toBeInTheDocument();
    expect(screen.getByText(/need manual review and are excluded/i)).toBeInTheDocument();
  });

  it('renders the backend blocked-permissions message when provided', () => {
    render(
      <PermissionErrorPanel
        error="not authorized to perform: iam:PassRole on resource"
        missingActions={[]}
        fixScript="# WARNING: 1 required permission(s) need manual review and were NOT granted: iam:PassRole"
        blockedPermissions={['iam:PassRole']}
        blockedPermissionsMessage="Custom backend message."
      />,
    );
    expect(screen.getByText(/Custom backend message\./)).toBeInTheDocument();
  });
});

describe('PermissionErrorPanel error-shape detection', () => {
  it.each([
    'Access Denied: User is not authorized to perform s3:ListBucket',
    'UnauthorizedAccess: missing credentials for ec2:DescribeInstances',
    'AuthorizationFailed: role assignment missing on subscription scope',
    'Error 403: Forbidden when calling the API',
    'User iam-operator does not have serviceusage.services.use access',
  ])('routes %s to the permission panel with a fix script or retry', (error) => {
    const onRetry = vi.fn();
    render(<PermissionErrorPanel error={error} onRetry={onRetry} />);
    expect(screen.queryByText(/fix could not be applied/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^missing (gcp )?iam permission$/i)).toBeInTheDocument();
  });

  it('still offers retry when no script could be built from the error', () => {
    const onRetry = vi.fn();
    render(
      <PermissionErrorPanel
        error="Access Denied: request blocked by an explicit deny with no parseable action token"
        onRetry={onRetry}
      />,
    );
    expect(document.querySelector('pre')).toBeNull();
    expect(screen.getByText(/no fix script could be built/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
