import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CloudShellSetup } from './CloudShellSetup';

const SCRIPT =
  '# setup\nset -e\nEXTERNAL_ID="YOUR_EXTERNAL_ID"\nrun-first\nrun-second\nrun-third\nrun-fourth';

describe('CloudShellSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
  });

  it('shows a preview with an expand toggle when enabled', () => {
    render(<CloudShellSetup script={SCRIPT} externalId="org_1_abc" />);

    expect(screen.getByRole('button', { name: /show full script/i })).toBeInTheDocument();
    expect(screen.queryByText(/run-fourth/)).not.toBeInTheDocument();
  });

  it('expands to the full script and collapses back when enabled', () => {
    render(<CloudShellSetup script={SCRIPT} externalId="org_1_abc" />);

    fireEvent.click(screen.getByRole('button', { name: /show full script/i }));
    expect(screen.getByText(/run-fourth/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(screen.queryByText(/run-fourth/)).not.toBeInTheDocument();
  });

  it('hides the expand toggle and shows the disabled message when disabled', () => {
    render(
      <CloudShellSetup
        script={SCRIPT}
        externalId="org_1_abc"
        disabled
        disabledMessage="Generate your External ID below first."
      />,
    );

    expect(screen.getByText('Generate your External ID below first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show full script/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument();
  });

  it('disables the copy button when disabled', () => {
    render(<CloudShellSetup script={SCRIPT} externalId="org_1_abc" disabled />);

    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();
  });

  it('collapses back to the preview when the script becomes unavailable', () => {
    const { rerender } = render(<CloudShellSetup script={SCRIPT} externalId="org_1_abc" />);

    fireEvent.click(screen.getByRole('button', { name: /show full script/i }));
    expect(screen.getByText(/run-fourth/)).toBeInTheDocument();

    rerender(
      <CloudShellSetup
        script={SCRIPT}
        externalId="org_1_abc"
        disabled
        disabledMessage="Generate your External ID below first."
      />,
    );
    rerender(<CloudShellSetup script={SCRIPT} externalId="org_1_abc" />);

    expect(screen.queryByText(/run-fourth/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show full script/i })).toBeInTheDocument();
  });

  it('copies the script with the external id interpolated when enabled', () => {
    render(<CloudShellSetup script={SCRIPT} externalId="org_1_abc" />);

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('EXTERNAL_ID="org_1_abc"'),
    );
  });
});
