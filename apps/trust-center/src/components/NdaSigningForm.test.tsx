import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NdaSigningForm } from './NdaSigningForm';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('NdaSigningForm', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn().mockReturnValue('blob:nda-preview');
        static revokeObjectURL = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function stubFetch(response: { ok: boolean; status?: number; body?: unknown }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: () => Promise.resolve(response.body ?? null),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function stubPopup() {
    const popup = {
      location: { href: '' },
      close: vi.fn(),
      opener: 'opener' as unknown as Window | null,
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    return popup;
  }

  function renderForm() {
    return render(
      <NdaSigningForm token="tok 1" defaultName="Ada Lovelace" defaultEmail="ada@company.com" />,
    );
  }

  async function fillValidExcept(overrides: { name?: string; email?: string } = {}) {
    fireEvent.change(screen.getByPlaceholderText('Ada Lovelace'), {
      target: { value: overrides.name ?? 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('ada@company.com'), {
      target: { value: overrides.email ?? 'ada@company.com' },
    });
    fireEvent.click(screen.getByLabelText(/agree to its terms/i));
  }

  it('prefills the requester name and email', () => {
    renderForm();

    expect(screen.getByPlaceholderText('Ada Lovelace')).toHaveValue('Ada Lovelace');
    expect(screen.getByPlaceholderText('ada@company.com')).toHaveValue('ada@company.com');
  });

  it('blocks submit on an invalid email without calling the API', async () => {
    const fetchMock = stubFetch({ ok: true });
    renderForm();
    await fillValidExcept({ email: 'not-an-email' });
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() => expect(screen.getByText('Enter a valid email')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submit on a short name without calling the API', async () => {
    const fetchMock = stubFetch({ ok: true });
    renderForm();
    await fillValidExcept({ name: 'A' });
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() => expect(screen.getByText('Enter your full name')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submit when the NDA checkbox is unchecked', async () => {
    const fetchMock = stubFetch({ ok: true });
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('Ada Lovelace'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() =>
      expect(screen.getByText('You must accept the NDA to proceed')).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs with an encoded token and shows the portal link on success', async () => {
    const fetchMock = stubFetch({
      ok: true,
      body: { portalUrl: 'https://trust.example.com/acme/access/grant-tok' },
    });
    renderForm();
    await fillValidExcept();
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/trust-access/nda/tok%201/sign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Ada Lovelace', email: 'ada@company.com', accept: true }),
      }),
    );
    await vi.waitFor(() => expect(screen.getByText('NDA signed')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Open trust portal' })).toHaveAttribute(
      'href',
      'https://trust.example.com/acme/access/grant-tok',
    );
    expect(toast.success).toHaveBeenCalledWith('NDA signed');
  });

  it('surfaces the server message when signing is rejected', async () => {
    const fetchMock = stubFetch({
      ok: false,
      body: { message: 'Signer email must match the access request email' },
    });
    renderForm();
    await fillValidExcept();
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Signer email must match the access request email'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('NDA signed')).not.toBeInTheDocument();
  });

  it('reports a generic failure when the network drops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    renderForm();
    await fillValidExcept();
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not sign the NDA — try again later'),
    );
    expect(screen.queryByText('NDA signed')).not.toBeInTheDocument();
  });

  it('never reports success when the portal link is missing or unsafe', async () => {
    stubFetch({ ok: true, body: { portalUrl: 'javascript:alert(1)' } });
    renderForm();
    await fillValidExcept();
    fireEvent.click(screen.getByText('Sign NDA'));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'NDA signed but the portal link is missing — refresh the page',
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText('NDA signed')).not.toBeInTheDocument();
  });

  it('opens API PDF bytes in the popup and releases the blob URL on unmount', async () => {
    const popup = stubPopup();
    const pdf = new Blob(['%PDF-preview'], { type: 'application/pdf' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => pdf });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderForm();
    fireEvent.click(screen.getByText('Preview NDA'));

    await vi.waitFor(() => expect(popup.location.href).toBe('blob:nda-preview'));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/trust-access/nda/tok%201/preview-nda',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(pdf);
    expect(popup.opener).toBeNull();
    expect(popup.close).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:nda-preview');
  });

  it('warns when the popup is blocked without calling the API', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchMock = stubFetch({ ok: true });
    renderForm();
    fireEvent.click(screen.getByText('Preview NDA'));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Popup blocked — allow popups to preview the NDA'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes a pending preview if the form unmounts before the PDF arrives', async () => {
    const popup = stubPopup();
    let finish = () => {};
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await ready;
        return { ok: true, blob: async () => new Blob(['pdf'], { type: 'application/pdf' }) };
      }),
    );
    const { unmount } = renderForm();
    fireEvent.click(screen.getByText('Preview NDA'));
    unmount();
    finish();

    await vi.waitFor(() => expect(popup.close).toHaveBeenCalledOnce());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('closes the popup and surfaces the error when preview fails', async () => {
    const popup = stubPopup();
    stubFetch({ ok: false, body: { message: 'NDA has already been signed' } });
    renderForm();
    fireEvent.click(screen.getByText('Preview NDA'));

    await vi.waitFor(() => expect(popup.close).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('NDA has already been signed');
    expect(popup.location.href).toBe('');
  });

  it('closes the popup when the API returns JSON instead of a PDF', async () => {
    const popup = stubPopup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['{}'], { type: 'application/json' }),
      }),
    );
    renderForm();
    fireEvent.click(screen.getByText('Preview NDA'));

    await vi.waitFor(() => expect(popup.close).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('Could not preview the NDA');
    expect(popup.location.href).toBe('');
  });

  it('closes the popup with generic copy when preview hits a network failure', async () => {
    const popup = stubPopup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    renderForm();
    fireEvent.click(screen.getByText('Preview NDA'));

    await vi.waitFor(() => expect(popup.close).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('Could not preview the NDA');
  });
});
