import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchPreviewNdaPdf, mockToastPromise } = vi.hoisted(() => ({
  mockFetchPreviewNdaPdf: vi.fn(),
  mockToastPromise: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock('@/hooks/use-access-requests', () => ({
  useAccessRequests: () => ({
    data: [
      {
        id: 'req_1',
        name: 'Jane',
        email: 'jane@example.com',
        status: 'under_review',
        createdAt: new Date().toISOString(),
      },
    ],
    isLoading: false,
  }),
  useResendNda: () => ({ mutateAsync: vi.fn() }),
  fetchPreviewNdaPdf: (...args: unknown[]) => mockFetchPreviewNdaPdf(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    promise: (promise: Promise<unknown>) => mockToastPromise(promise),
    error: vi.fn(),
  },
}));

vi.mock('./request-data-table', () => ({
  RequestDataTable: ({ onPreviewNda }: { onPreviewNda: (row: { id: string }) => void }) => (
    <button onClick={() => onPreviewNda({ id: 'req_1' })}>Preview</button>
  ),
}));

vi.mock('./approve-dialog', () => ({
  ApproveDialog: () => null,
}));

vi.mock('./deny-dialog', () => ({
  DenyDialog: () => null,
}));

import { RequestsTab } from './request-tab';

describe('RequestsTab NDA preview object URL cleanup', () => {
  let opened: {
    location: { href: string };
    addEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    opener: unknown;
  };
  let loadHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    loadHandler = undefined;
    opened = {
      location: { href: '' },
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'load') {
          loadHandler = handler;
        }
      }),
      close: vi.fn(),
      opener: {},
    };
    vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    // jsdom does not implement URL.createObjectURL — assign mocks directly
    // instead of spyOn, which requires the property to exist.
    URL.createObjectURL = vi.fn().mockReturnValue('blob:preview');
    URL.revokeObjectURL = vi.fn(() => undefined);
    mockFetchPreviewNdaPdf.mockResolvedValue(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
  });

  it('revokes the preview object URL after the new tab loads', async () => {
    render(<RequestsTab orgId="org_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(opened.location.href).toBe('blob:preview');
    expect(opened.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), {
      once: true,
    });

    loadHandler?.();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('schedules a timeout fallback to revoke the preview object URL', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    render(<RequestsTab orgId="org_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    const timeoutCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 60_000);
    expect(timeoutCall).toBeDefined();

    (timeoutCall?.[0] as () => void)();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('ignores a second click while a preview fetch is in flight', async () => {
    let resolveFetch!: (blob: Blob) => void;
    mockFetchPreviewNdaPdf.mockReturnValueOnce(
      new Promise<Blob>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    render(<RequestsTab orgId="org_1" />);
    const button = screen.getByRole('button', { name: 'Preview' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockFetchPreviewNdaPdf).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);

    resolveFetch(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    // The guard clears once the fetch settles, so a later click works again.
    fireEvent.click(button);
    await waitFor(() => expect(mockFetchPreviewNdaPdf).toHaveBeenCalledTimes(2));
  });
});
