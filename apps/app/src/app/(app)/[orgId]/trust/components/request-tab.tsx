import { fetchPreviewNdaPdf, useAccessRequests, useResendNda } from '@/hooks/use-access-requests';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Stack,
} from '@trycompai/design-system';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApproveDialog } from './approve-dialog';
import { DenyDialog } from './deny-dialog';
import { RequestDataTable } from './request-data-table';

export function RequestsTab({ orgId }: { orgId: string }) {
  const { data, isLoading } = useAccessRequests(orgId);
  const { mutateAsync: resendNda } = useResendNda(orgId);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [denyId, setDenyId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | 'all'>('all');
  // One preview fetch per request: a second click while the first is still
  // running would open a second tab and mint a second PDF for the same key.
  const previewInFlight = useRef(new Set<string>());

  const statusOptions = [
    { value: 'all', label: 'All statuses' },
    { value: 'under_review', label: 'Under review' },
    { value: 'approved', label: 'Approved' },
    { value: 'denied', label: 'Denied' },
  ];

  const selectedStatusLabel =
    statusOptions.find((opt) => opt.value === status)?.label ?? 'Filter status';

  const handleResendNda = (requestId: string) => {
    toast.promise(resendNda(requestId), {
      loading: 'Resending...',
      success: 'NDA email resent',
      error: 'Failed to resend NDA',
    });
  };

  const handlePreviewNda = (requestId: string) => {
    // Open synchronously in the click handler so popup blockers don't
    // intercept the tab, then fill it with the fetched PDF bytes. Fetching
    // through the API (instead of navigating straight to the URL) surfaces
    // 404/401/403/500 as toasts instead of a blank tab or raw JSON.
    if (previewInFlight.current.has(requestId)) {
      return;
    }
    const opened = window.open('about:blank', '_blank');
    if (!opened) {
      toast.error('Popup blocked — allow popups to preview the NDA');
      return;
    }
    opened.opener = null;
    previewInFlight.current.add(requestId);
    const cleanupPreview = () => {
      previewInFlight.current.delete(requestId);
    };

    toast.promise(
      fetchPreviewNdaPdf(requestId)
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          opened.location.href = objectUrl;
          // The blob URL is owned by this document, so revoke it once the
          // new tab finishes loading. Keep a timeout fallback in case the
          // load event never fires.
          const revokeObjectUrl = () => URL.revokeObjectURL(objectUrl);
          opened.addEventListener('load', revokeObjectUrl, { once: true });
          window.setTimeout(revokeObjectUrl, 60_000);
        })
        .finally(cleanupPreview),
      {
        loading: 'Generating preview...',
        success: 'Preview NDA generated',
        error: (error: unknown) => {
          opened.close();
          return error instanceof Error ? error.message : 'Failed to generate preview';
        },
      },
    );
  };

  const filtered = (data ?? []).filter((request) => {
    const matchesSearch =
      !search ||
      request.email.toLowerCase().includes(search.toLowerCase()) ||
      request.name.toLowerCase().includes(search.toLowerCase()) ||
      (request.company ?? '').toLowerCase().includes(search.toLowerCase());

    const matchesStatus = status === 'all' || request.status === status;
    return matchesSearch && matchesStatus;
  });

  return (
    <Stack gap="4">
      <Stack direction="row" gap="2" align="center">
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Search by name, email, or company"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-[200px]">
          <Select value={status} onValueChange={(value) => setStatus(value as string)}>
            <SelectTrigger>{selectedStatusLabel}</SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Stack>

      <RequestDataTable
        data={filtered}
        isLoading={isLoading}
        onApprove={(row) => setApproveId(row.id)}
        onDeny={(row) => setDenyId(row.id)}
        onResendNda={(row) => handleResendNda(row.id)}
        onPreviewNda={(row) => handlePreviewNda(row.id)}
      />

      {approveId && (
        <ApproveDialog orgId={orgId} requestId={approveId} onClose={() => setApproveId(null)} />
      )}
      {denyId && <DenyDialog orgId={orgId} requestId={denyId} onClose={() => setDenyId(null)} />}
    </Stack>
  );
}
