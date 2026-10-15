'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { apiClient } from '@/lib/api-client';
import type { Member, User } from '@db';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { BackgroundCheckAdminActions } from './BackgroundCheckAdminActions';
import type { AttachFormValues } from './BackgroundCheckAttachForm';
import {
  BackgroundCheckDisabledNotice,
  BackgroundCheckExemptToggle,
  BackgroundCheckNotice,
} from './BackgroundCheckNotices';
import type { OrderFormValues } from './BackgroundCheckOrderForm';
import { BackgroundCheckStatusView } from './BackgroundCheckStatusView';
import type { BackgroundCheckBillingStatus, BackgroundCheckRecord } from './backgroundCheckTypes';
import {
  buildAttachNotes,
  computeCredits,
  fileToBase64,
  isValidEmail,
} from './backgroundCheckUtils';
import { BackgroundCheckV1Page, type SelectedPath } from './BackgroundCheckV1Page';
import {
  getBackgroundChecksRemaining,
  useBackgroundCheckBillingStatus,
  useBackgroundCheckRecord,
} from './useEmployeeBackgroundCheckData';

interface EmployeeBackgroundCheckProps {
  employee: Member & { user: User };
  organizationId: string;
  initialBackgroundCheck: BackgroundCheckRecord | null;
  initialBillingStatus: BackgroundCheckBillingStatus;
  backgroundCheckStepEnabled: boolean;
  memberBackgroundCheckExempt: boolean;
}

export function EmployeeBackgroundCheck({
  employee,
  organizationId,
  initialBackgroundCheck,
  initialBillingStatus,
  backgroundCheckStepEnabled,
  memberBackgroundCheckExempt,
}: EmployeeBackgroundCheckProps) {
  const t = useTranslations('people');
  const [selectedPath, setSelectedPath] = useState<SelectedPath>('order');
  const [orderValues, setOrderValues] = useState<OrderFormValues>({
    employeeName: employee.user.name ?? '',
    employeeEmail: '',
    requesterNotes: '',
  });
  const [orderErrors, setOrderErrors] = useState<Partial<Record<keyof OrderFormValues, string>>>(
    {},
  );
  const [attachValues, setAttachValues] = useState<AttachFormValues>({
    vendor: 'checkr',
    reportDate: '',
    file: null,
  });

  const [isOrderSubmitting, setIsOrderSubmitting] = useState(false);
  const [isAttachSubmitting, setIsAttachSubmitting] = useState(false);

  // The stored exemption is read-only: no local writer or Gideon sync exists.
  const exempt = memberBackgroundCheckExempt;
  const { hasPermission } = usePermissions();

  const { data: backgroundCheck, mutate: mutateBackgroundCheck } = useBackgroundCheckRecord({
    enabled: backgroundCheckStepEnabled,
    employeeId: employee.id,
    initialBackgroundCheck,
    organizationId,
  });
  const { data: billingStatus } = useBackgroundCheckBillingStatus({
    enabled: backgroundCheckStepEnabled,
    initialBillingStatus,
    organizationId,
  });

  const canRequest = hasPermission('member', 'update');
  const canManageBilling = hasPermission('organization', 'update');
  const remaining = getBackgroundChecksRemaining({ billingStatus });
  const { creditsUsed, creditsIncluded } = computeCredits(billingStatus);
  const hasAllowance = remaining !== null && remaining > 0;
  const planHref = `/${organizationId}/settings/billing/add-ons/background-checks`;

  const handleOrderSubmit = async () => {
    const errors: Partial<Record<keyof OrderFormValues, string>> = {};
    if (!orderValues.employeeName.trim()) {
      errors.employeeName = t('backgroundCheck.main.nameRequired');
    }
    if (!isValidEmail(orderValues.employeeEmail)) {
      errors.employeeEmail = t('backgroundCheck.main.invalidPersonalEmail');
    }
    setOrderErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsOrderSubmitting(true);
    const response = await apiClient.post<BackgroundCheckRecord>(
      `/v1/people/${employee.id}/background-check`,
      {
        employeeName: orderValues.employeeName.trim(),
        employeeEmail: orderValues.employeeEmail.trim(),
        requesterNotes: orderValues.requesterNotes?.trim() || undefined,
      },
      organizationId,
    );
    setIsOrderSubmitting(false);

    if (response.error || !response.data) {
      toast.error(t('backgroundCheck.main.requestFailed'));
      return;
    }

    toast.success(t('backgroundCheck.main.inviteSentTo', { email: orderValues.employeeEmail }));
    await mutateBackgroundCheck(response.data, { revalidate: false });
  };

  const handleAttachSubmit = async () => {
    if (!attachValues.file) return;

    setIsAttachSubmitting(true);
    try {
      const fileData = await fileToBase64(attachValues.file);
      const response = await apiClient.post<BackgroundCheckRecord>(
        `/v1/people/${employee.id}/background-check/custom`,
        {
          employeeName: employee.user.name ?? employee.user.email,
          employeeEmail: employee.user.email,
          fileName: attachValues.file.name,
          fileType: attachValues.file.type || 'application/pdf',
          fileData,
          requesterNotes: buildAttachNotes(attachValues),
        },
        organizationId,
      );

      if (response.error || !response.data) {
        toast.error(t('backgroundCheck.main.uploadFailed'));
        return;
      }

      toast.success(t('backgroundCheck.main.customAttached'));
      await mutateBackgroundCheck(response.data, { revalidate: false });
    } catch {
      toast.error(t('backgroundCheck.main.uploadFailed'));
    } finally {
      setIsAttachSubmitting(false);
    }
  };

  if (!backgroundCheckStepEnabled) {
    return <BackgroundCheckDisabledNotice />;
  }

  if (exempt) {
    return (
      <div className="flex flex-col gap-4">
        <BackgroundCheckExemptToggle
          exempt={exempt}
          saving={false}
          canUpdate={false}
          onToggle={() => undefined}
        />
        <BackgroundCheckNotice
          title={t('backgroundCheck.main.exemptNoticeTitle')}
          body={t('backgroundCheck.main.exemptNoticeBody')}
        />
        <BackgroundCheckNotice
          title="Exemption changes are unavailable"
          body="This member's stored exemption status is read-only. OpenComp does not sync exemption changes from Gideon."
        />
      </div>
    );
  }

  if (backgroundCheck) {
    return (
      <div className="flex flex-col gap-4">
        <BackgroundCheckExemptToggle
          exempt={exempt}
          saving={false}
          canUpdate={false}
          onToggle={() => undefined}
        />
        <BackgroundCheckStatusView
          backgroundCheck={backgroundCheck}
          memberId={employee.id}
          organizationId={organizationId}
          actions={
            <BackgroundCheckAdminActions
              backgroundCheck={backgroundCheck}
              memberId={employee.id}
              organizationId={organizationId}
              onChange={(next) => {
                mutateBackgroundCheck(next, { revalidate: false });
              }}
            />
          }
        />
      </div>
    );
  }

  return (
    <BackgroundCheckV1Page
      selectedPath={selectedPath}
      onSelectedPathChange={setSelectedPath}
      creditsUsed={creditsUsed}
      creditsIncluded={creditsIncluded}
      planHref={planHref}
      canManageBilling={canManageBilling}
      orderValues={orderValues}
      orderErrors={orderErrors}
      onOrderChange={setOrderValues}
      onOrderSubmit={handleOrderSubmit}
      isOrderSubmitting={isOrderSubmitting}
      hasAllowance={hasAllowance}
      attachValues={attachValues}
      onAttachChange={setAttachValues}
      onAttachSubmit={handleAttachSubmit}
      isAttachSubmitting={isAttachSubmitting}
      canRequest={canRequest}
    />
  );
}
