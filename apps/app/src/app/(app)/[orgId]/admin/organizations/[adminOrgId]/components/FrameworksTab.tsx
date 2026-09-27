'use client';

import { api } from '@/lib/api-client';
import {
  Badge,
  Button,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { Add } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ActiveFrameworkRow } from './ActiveFrameworkRow';
import { FrameworkConfirmationDialog } from './FrameworkConfirmationDialog';
import { ActiveFrameworkCards, AvailableFrameworkCards } from './FrameworkMobileCards';
import {
  getActiveFrameworkDetails,
  type ActiveFramework,
  type FrameworkDetails,
  type PendingAction,
} from './FrameworksTabTypes';

export type { ActiveFramework, FrameworkDetails, PendingAction } from './FrameworksTabTypes';

interface AdminFrameworksResponse {
  frameworks: ActiveFramework[];
  availableFrameworks: FrameworkDetails[];
}

export function FrameworksTab({ orgId }: { orgId: string }) {
  const t = useTranslations('admin');
  const [frameworks, setFrameworks] = useState<ActiveFramework[]>([]);
  const [availableFrameworks, setAvailableFrameworks] = useState<FrameworkDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const fetchFrameworks = useCallback(async () => {
    setLoading(true);
    const res = await api.get<AdminFrameworksResponse>(
      `/v1/admin/organizations/${orgId}/frameworks`,
    );
    if (res.error) {
      toast.error(res.error);
    }
    if (res.data) {
      setFrameworks(res.data.frameworks);
      setAvailableFrameworks(res.data.availableFrameworks);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<AdminFrameworksResponse>(
        `/v1/admin/organizations/${orgId}/frameworks`,
      );
      if (cancelled) return;
      if (res.error) {
        toast.error(res.error);
      }
      if (res.data) {
        setFrameworks(res.data.frameworks);
        setAvailableFrameworks(res.data.availableFrameworks);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleDialogOpenChange = (open: boolean) => {
    if (submitting) return;
    if (!open) {
      setPendingAction(null);
    }
  };

  const handleConfirm = async () => {
    if (!pendingAction) return;

    setSubmitting(true);
    const response =
      pendingAction.type === 'add'
        ? await api.post(`/v1/admin/organizations/${orgId}/frameworks`, {
            frameworkIds: [pendingAction.framework.id],
          })
        : await api.delete(
            `/v1/admin/organizations/${orgId}/frameworks/${pendingAction.framework.id}`,
          );

    setSubmitting(false);

    if (response.error) {
      toast.error(response.error);
      return;
    }

    toast.success(
      pendingAction.type === 'add'
        ? t('organizations.frameworksTab.addedSuccess')
        : t('organizations.frameworksTab.removedSuccess'),
    );
    setPendingAction(null);
    await fetchFrameworks();
  };

  const activeName = (framework: ActiveFramework) =>
    getActiveFrameworkDetails(framework)?.name ?? '';
  const sortedFrameworks = [...frameworks].sort((a, b) =>
    activeName(a).localeCompare(activeName(b)),
  );
  const sortedAvailableFrameworks = [...availableFrameworks].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t('organizations.frameworksTab.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Section
        title={t('organizations.frameworksTab.activeFrameworks', {
          count: frameworks.length,
        })}
      >
        {frameworks.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {t('organizations.frameworksTab.emptyActive')}
          </div>
        ) : (
          <>
            <ActiveFrameworkCards
              frameworks={sortedFrameworks}
              onDelete={(framework) => {
                setPendingAction({ type: 'delete', framework });
              }}
            />
            <div className="hidden overflow-x-auto md:block">
              <Table variant="bordered">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('organizations.frameworksTab.name')}</TableHead>
                    <TableHead>{t('organizations.frameworksTab.version')}</TableHead>
                    <TableHead>{t('organizations.frameworksTab.type')}</TableHead>
                    <TableHead>{t('organizations.frameworksTab.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFrameworks.map((framework) => (
                    <ActiveFrameworkRow
                      key={framework.id}
                      framework={framework}
                      onDelete={(selectedFramework) => {
                        setPendingAction({
                          type: 'delete',
                          framework: selectedFramework,
                        });
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Section>

      <Section
        title={t('organizations.frameworksTab.availableFrameworks', {
          count: availableFrameworks.length,
        })}
      >
        {availableFrameworks.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {t('organizations.frameworksTab.emptyAvailable')}
          </div>
        ) : (
          <>
            <AvailableFrameworkCards
              frameworks={sortedAvailableFrameworks}
              onAdd={(framework) => {
                setPendingAction({ type: 'add', framework });
              }}
            />
            <div className="hidden overflow-x-auto md:block">
              <Table variant="bordered">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('organizations.frameworksTab.name')}</TableHead>
                    <TableHead>{t('organizations.frameworksTab.version')}</TableHead>
                    <TableHead>{t('organizations.frameworksTab.description')}</TableHead>
                    <TableHead>{t('organizations.frameworksTab.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAvailableFrameworks.map((framework) => (
                    <TableRow key={framework.id}>
                      <TableCell>
                        <Text size="sm" weight="medium">
                          {framework.name}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">v{framework.version}</Badge>
                      </TableCell>
                      <TableCell>
                        <Text size="sm" variant="muted">
                          {framework.description ?? '--'}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          iconLeft={<Add size={16} />}
                          onClick={() => {
                            setPendingAction({ type: 'add', framework });
                          }}
                        >
                          {t('organizations.frameworksTab.add')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Section>

      <FrameworkConfirmationDialog
        pendingAction={pendingAction}
        submitting={submitting}
        onOpenChange={handleDialogOpenChange}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
