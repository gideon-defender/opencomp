'use client';

import { api } from '@/lib/api-client';
import {
  Badge,
  Button,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { Add, View } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PolicyContentSheet } from './PolicyContentSheet';
import { PolicyForm } from './PolicyForm';

interface Policy {
  id: string;
  name: string;
  description: string | null;
  status: string;
  department: string | null;
  frequency: string | null;
  lastPublishedAt: string | null;
  content: unknown[];
  draftContent?: unknown[];
  assignee: { id: string; user: { name: string } } | null;
}

const STATUS_OPTIONS = ['draft', 'published', 'needs_review'];
const DEPARTMENT_OPTIONS = ['none', 'admin', 'gov', 'hr', 'it', 'itsm', 'qms'];
const FREQUENCY_OPTIONS = ['monthly', 'quarterly', 'yearly'];

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  published: 'default',
  needs_review: 'secondary',
};

type AdminTranslator = ReturnType<typeof useTranslations<'admin'>>;

function statusLabel(t: AdminTranslator, status: string) {
  switch (status) {
    case 'draft':
      return t('organizations.policiesTab.statuses.draft');
    case 'published':
      return t('organizations.policiesTab.statuses.published');
    case 'needs_review':
      return t('organizations.policiesTab.statuses.needsReview');
    default:
      return status;
  }
}

function departmentLabel(t: AdminTranslator, value: string) {
  switch (value) {
    case 'none':
      return t('organizations.policiesTab.departments.none');
    case 'admin':
      return t('organizations.policiesTab.departments.admin');
    case 'gov':
      return t('organizations.policiesTab.departments.gov');
    case 'hr':
      return t('organizations.policiesTab.departments.hr');
    case 'it':
      return t('organizations.policiesTab.departments.it');
    case 'itsm':
      return t('organizations.policiesTab.departments.itsm');
    case 'qms':
      return t('organizations.policiesTab.departments.qms');
    default:
      return value;
  }
}

function frequencyLabel(t: AdminTranslator, value: string) {
  switch (value) {
    case 'monthly':
      return t('organizations.policiesTab.frequencies.monthly');
    case 'quarterly':
      return t('organizations.policiesTab.frequencies.quarterly');
    case 'yearly':
      return t('organizations.policiesTab.frequencies.yearly');
    default:
      return value;
  }
}

export function PoliciesTab({ orgId }: { orgId: string }) {
  const t = useTranslations('admin');
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [viewingPolicy, setViewingPolicy] = useState<Policy | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Policy[]>(`/v1/admin/organizations/${orgId}/policies`);
    if (res.data) setPolicies(res.data);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<Policy[]>(`/v1/admin/organizations/${orgId}/policies`);
      if (cancelled) return;
      if (res.data) setPolicies(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleFieldChange = async (policyId: string, field: string, value: string | null) => {
    setUpdatingId(policyId);
    const res = await api.patch(`/v1/admin/organizations/${orgId}/policies/${policyId}`, {
      [field]: value,
    });
    if (!res.error) {
      setPolicies((prev) => prev.map((p) => (p.id === policyId ? { ...p, [field]: value } : p)));
    }
    setUpdatingId(null);
  };

  const handleCreated = () => {
    setShowForm(false);
    void fetchPolicies();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t('organizations.policiesTab.loading')}
      </div>
    );
  }

  return (
    <>
      <Section
        title={t('organizations.policiesTab.title', { count: policies.length })}
        actions={
          <Button size="sm" iconLeft={<Add size={16} />} onClick={() => setShowForm(true)}>
            {t('organizations.policiesTab.createPolicy')}
          </Button>
        }
      >
        {policies.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {t('organizations.policiesTab.empty')}
          </div>
        ) : (
          <Table variant="bordered">
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.policiesTab.colName')}</TableHead>
                <TableHead>{t('organizations.policiesTab.colStatus')}</TableHead>
                <TableHead>{t('organizations.policiesTab.colDepartment')}</TableHead>
                <TableHead>{t('organizations.policiesTab.colFrequency')}</TableHead>
                <TableHead>{t('organizations.policiesTab.colAssignee')}</TableHead>
                <TableHead>{t('organizations.policiesTab.colLastPublished')}</TableHead>
                <TableHead>{t('organizations.policiesTab.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...policies]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((policy) => (
                  <PolicyRow
                    key={policy.id}
                    policy={policy}
                    isUpdating={updatingId === policy.id}
                    onFieldChange={handleFieldChange}
                    onView={setViewingPolicy}
                  />
                ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <PolicyContentSheet
        policy={viewingPolicy}
        orgId={orgId}
        onClose={() => setViewingPolicy(null)}
        onRegenerated={() => {
          setViewingPolicy(null);
          void fetchPolicies();
        }}
      />

      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('organizations.policiesTab.createPolicy')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <PolicyForm orgId={orgId} onCreated={handleCreated} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

function PolicyRow({
  policy,
  isUpdating,
  onFieldChange,
  onView,
}: {
  policy: Policy;
  isUpdating: boolean;
  onFieldChange: (id: string, field: string, value: string | null) => void;
  onView: (policy: Policy) => void;
}) {
  const t = useTranslations('admin');

  return (
    <TableRow>
      <TableCell>
        <div className="max-w-[400px]">
          <div className="truncate">
            <Text size="sm" weight="medium">
              {policy.name}
            </Text>
          </div>
          {policy.description && (
            <div className="truncate">
              <Text size="xs" variant="muted">
                {policy.description}
              </Text>
            </div>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Select
          value={policy.status}
          onValueChange={(val) => {
            if (val) void onFieldChange(policy.id, 'status', val);
          }}
          disabled={isUpdating}
        >
          <SelectTrigger size="sm">
            <Badge variant={STATUS_VARIANT[policy.status] ?? 'default'}>
              {statusLabel(t, policy.status)}
            </Badge>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(t, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={policy.department ?? 'none'}
          onValueChange={(val) => {
            if (val) void onFieldChange(policy.id, 'department', val);
          }}
          disabled={isUpdating}
        >
          <SelectTrigger size="sm">
            <span className="text-sm">{departmentLabel(t, policy.department ?? 'none')}</span>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {DEPARTMENT_OPTIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {departmentLabel(t, d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={policy.frequency ?? 'none'}
          onValueChange={(val) => {
            if (val) void onFieldChange(policy.id, 'frequency', val === 'none' ? null : val);
          }}
          disabled={isUpdating}
        >
          <SelectTrigger size="sm">
            <span className="text-sm">
              {policy.frequency ? frequencyLabel(t, policy.frequency) : '--'}
            </span>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="none">--</SelectItem>
            {FREQUENCY_OPTIONS.map((f) => (
              <SelectItem key={f} value={f}>
                {frequencyLabel(t, f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Text size="sm" variant="muted">
          {policy.assignee?.user.name ?? '--'}
        </Text>
      </TableCell>
      <TableCell>
        <Text size="sm" variant="muted">
          {policy.lastPublishedAt ? new Date(policy.lastPublishedAt).toLocaleDateString() : '--'}
        </Text>
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="outline"
          iconLeft={<View size={16} />}
          onClick={() => onView(policy)}
        >
          {t('organizations.policiesTab.view')}
        </Button>
      </TableCell>
    </TableRow>
  );
}
