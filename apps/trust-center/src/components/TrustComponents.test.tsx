import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComplianceRail } from './ComplianceRail';

describe('ComplianceRail', () => {
  it('renders framework titles with status pills', () => {
    const { container } = render(
      <ComplianceRail
        frameworks={[
          { key: 'dora', title: 'DORA', status: 'compliant' },
          { key: 'nis_2', title: 'NIS 2', status: 'in_progress' },
        ]}
      />,
    );
    const titles = [...container.querySelectorAll('li p')].map((el) => el.textContent);
    expect(titles).toEqual(['DORA', 'NIS 2']);
    expect(screen.getByText('Compliant')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('All active')).toBeInTheDocument();
  });

  it('renders an empty state with no All-active label', () => {
    render(<ComplianceRail frameworks={[]} />);
    expect(screen.getByText('No frameworks published yet.')).toBeInTheDocument();
    expect(screen.queryByText('All active')).not.toBeInTheDocument();
  });

  it('prefers badge images over shields when provided', () => {
    const { container } = render(
      <ComplianceRail
        frameworks={[
          {
            key: 'custom-1',
            title: 'Custom FW',
            status: 'started',
            badgeUrl: 'https://example.com/badge.png',
          },
        ]}
      />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/badge.png');
    // No shield artwork (which renders acronym <text>), only the status icon.
    expect(container.querySelector('svg text')).toBeNull();
  });
});

describe('RequestAccessActions', () => {
  it('opens the dialog with a preset purpose from the questionnaire button', async () => {
    const { RequestAccessActions } = await import('./RequestAccessActions');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RequestAccessActions friendlyUrl="acme" organizationName="Acme" questionnaireAvailable />,
    );
    fireEvent.click(screen.getByText('Security questionnaire'));
    expect(screen.getByRole('dialog', { name: 'Request access to Acme' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/need access for/i)).toHaveValue('Security questionnaire');
    vi.unstubAllGlobals();
  });

  it('posts to the configured API base with an encoded portal id', async () => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    const { RequestAccessActions } = await import('./RequestAccessActions');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RequestAccessActions
        friendlyUrl="acme security"
        organizationName="Acme"
        questionnaireAvailable={false}
      />,
    );
    fireEvent.click(screen.getByText('Request access'));
    fireEvent.change(screen.getByPlaceholderText('Ada Lovelace'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('ada@company.com'), {
      target: { value: 'ada@company.com' },
    });
    fireEvent.click(screen.getByText('Send request'));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/trust-access/acme%20security/requests',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('blocks submit on an invalid email without calling the API', async () => {
    const { RequestAccessActions } = await import('./RequestAccessActions');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RequestAccessActions
        friendlyUrl="acme"
        organizationName="Acme"
        questionnaireAvailable={false}
      />,
    );
    fireEvent.click(screen.getByText('Request access'));
    fireEvent.change(screen.getByPlaceholderText('Ada Lovelace'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('ada@company.com'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByText('Send request'));

    await vi.waitFor(() =>
      expect(screen.getByText('Enter a valid work email')).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('surfaces the server error message on a rejected request', async () => {
    const { RequestAccessActions } = await import('./RequestAccessActions');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'A request is already under review' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RequestAccessActions
        friendlyUrl="acme"
        organizationName="Acme"
        questionnaireAvailable={false}
      />,
    );
    fireEvent.click(screen.getByText('Request access'));
    fireEvent.change(screen.getByPlaceholderText('Ada Lovelace'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('ada@company.com'), {
      target: { value: 'ada@company.com' },
    });
    fireEvent.click(screen.getByText('Send request'));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });
});

describe('VendorRow', () => {
  it('renders the whole row as a hoverable link', async () => {
    const { VendorRow } = await import('./VendorRow');
    const { container } = render(
      <VendorRow
        vendor={{
          id: 'vnd_gh',
          name: 'GitHub',
          description: 'Code hosting',
          website: 'https://github.com',
          logoUrl: null,
          complianceBadges: null,
          trustPortalUrl: null,
        }}
      />,
    );
    const link = screen.getByRole('link', { name: 'GitHub website' });
    expect(link).toHaveAttribute('href', 'https://github.com');
    expect(link.className).toContain('hover:bg-canvas');
    expect(link.className).toContain('transition-colors');
    expect(container.querySelector('li, div > a')).toBeTruthy();
  });

  it('renders a plain row without link when no website exists', () => {
    return import('./VendorRow').then(({ VendorRow }) => {
      render(
        <VendorRow
          vendor={{
            id: 'vnd_x',
            name: 'Internal Tool',
            description: null,
            website: null,
            logoUrl: null,
            complianceBadges: null,
            trustPortalUrl: null,
          }}
        />,
      );
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByText('Internal Tool')).toBeInTheDocument();
    });
  });

  it('renders a plain row for a non-http(s) stored website', async () => {
    const { VendorRow } = await import('./VendorRow');
    render(
      <VendorRow
        vendor={{
          id: 'vnd_bad',
          name: 'Evil Vendor',
          description: null,
          website: 'javascript:alert(1)',
          logoUrl: null,
          complianceBadges: null,
          trustPortalUrl: null,
        }}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Evil Vendor')).toBeInTheDocument();
  });
});
