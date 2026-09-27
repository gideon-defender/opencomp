'use client';

import { CreateFindingSheet } from '@/app/(app)/[orgId]/overview/components/CreateFindingSheet';
import type { CreateFindingData } from '@/hooks/use-findings-api';
import { api } from '@/lib/api-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Section,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@trycompai/design-system';
import { Add } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { AdminFindingRow, getTargetLabel, type AdminFinding } from './AdminFindingRow';
import { EditFindingSheet } from './EditFindingSheet';

export function FindingsTab({ orgId }: { orgId: string }) {
  const t = useTranslations('admin');
  const [findings, setFindings] = useState<AdminFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingFinding, setEditingFinding] = useState<AdminFinding | null>(null);
  const [deletingFinding, setDeletingFinding] = useState<AdminFinding | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    const res = await api.get<AdminFinding[]>(`/v1/admin/organizations/${orgId}/findings`);
    if (res.data) setFindings(res.data);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<AdminFinding[]>(`/v1/admin/organizations/${orgId}/findings`);
      if (cancelled) return;
      if (res.data) setFindings(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleStatusChange = async (findingId: string, newStatus: string) => {
    setUpdatingId(findingId);
    const res = await api.patch(`/v1/admin/organizations/${orgId}/findings/${findingId}`, {
      status: newStatus,
    });
    if (!res.error) {
      setFindings((prev) =>
        prev.map((f) => (f.id === findingId ? { ...f, status: newStatus } : f)),
      );
    }
    setUpdatingId(null);
  };

  const adminCreateFn = useCallback(
    async (payload: CreateFindingData) => {
      const res = await api.post(`/v1/admin/organizations/${orgId}/findings`, payload);
      if (res.error) throw new Error(res.error);
    },
    [orgId],
  );

  // Radix's AlertDialogAction auto-closes the dialog on click. We
  // preventDefault so the dialog stays open while the request is in flight,
  // and we only close it ourselves on success — keeping the confirm UI
  // mounted on error so the user can retry without re-opening the menu.
  const handleConfirmDelete = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!deletingFinding || deleting) return;
    setDeleting(true);
    const res = await api.delete(`/v1/admin/organizations/${orgId}/findings/${deletingFinding.id}`);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(t('organizations.findingsTab.toastDeleted'));
      setFindings((prev) => prev.filter((f) => f.id !== deletingFinding.id));
      setDeletingFinding(null);
    }
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t('organizations.findingsTab.loading')}
      </div>
    );
  }

  return (
    <>
      <Section
        title={t('organizations.findingsTab.title', { count: findings.length })}
        actions={
          <Button size="sm" iconLeft={<Add size={16} />} onClick={() => setShowForm(true)}>
            {t('organizations.findingsTab.logFinding')}
          </Button>
        }
      >
        {findings.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {t('organizations.findingsTab.empty')}
          </div>
        ) : (
          <Table variant="bordered">
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.findingsTab.colContent')}</TableHead>
                <TableHead>{t('organizations.findingsTab.colTarget')}</TableHead>
                <TableHead>{t('organizations.findingsTab.colSeverity')}</TableHead>
                <TableHead>{t('organizations.findingsTab.colCreatedBy')}</TableHead>
                <TableHead>{t('organizations.findingsTab.colStatus')}</TableHead>
                <TableHead>{t('organizations.findingsTab.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...findings]
                .sort((a, b) => a.content.localeCompare(b.content))
                .map((finding) => (
                  <AdminFindingRow
                    key={finding.id}
                    finding={finding}
                    statusUpdating={updatingId === finding.id}
                    onStatusChange={handleStatusChange}
                    onEdit={setEditingFinding}
                    onDelete={setDeletingFinding}
                  />
                ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <CreateFindingSheet
        organizationId={orgId}
        open={showForm}
        onOpenChange={setShowForm}
        createFn={adminCreateFn}
        // Route picker queries to the admin org-scoped endpoints so we fetch
        // the target org's tasks/policies/vendors/etc. instead of the platform
        // admin's own session org. Target kinds without an admin-scoped
        // endpoint (risk, member, device) are hidden from the dropdown.
        endpointOverrides={{
          task: `/v1/admin/organizations/${orgId}/tasks`,
          policy: `/v1/admin/organizations/${orgId}/policies`,
          vendor: `/v1/admin/organizations/${orgId}/vendors`,
          // Document-type definitions are static metadata, not org-scoped.
          // The admin `/evidence-forms` endpoint returns a status map keyed
          // by form type, which `extractOptions` can't render as picker
          // options — fall back to the default static endpoint.
        }}
        disabledTargetKinds={['risk', 'member', 'device']}
        onSuccess={() => {
          void fetchFindings();
        }}
      />

      <EditFindingSheet
        orgId={orgId}
        finding={editingFinding}
        targetLabel={editingFinding ? getTargetLabel(editingFinding) : ''}
        onOpenChange={(open) => {
          if (!open) setEditingFinding(null);
        }}
        onSaved={(updated) => {
          setFindings((prev) => prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)));
          setEditingFinding(null);
        }}
      />

      <AlertDialog
        open={deletingFinding !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingFinding(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('organizations.findingsTab.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('organizations.findingsTab.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t('organizations.findingsTab.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting
                ? t('organizations.findingsTab.deleting')
                : t('organizations.findingsTab.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
