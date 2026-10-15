'use client';

import type { Member, User } from '@db';
import { Grid, Label, Section, Stack } from '@trycompai/design-system';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';

type Translator = ReturnType<typeof useTranslations<'people'>>;

const statusOptionLabel = (value: string, t: Translator): string => {
  switch (value) {
    case 'inactive':
      return t('employeeDetails.statusInactive');
    default:
      return t('employeeDetails.statusActive');
  }
};

export const EmployeeDetails = ({
  employee,
}: {
  employee: Member & {
    user: User;
  };
}) => {
  const t = useTranslations('people');
  const status = employee.isActive ? 'active' : 'inactive';

  return (
    <Section>
      <Stack gap="md">
        <p className="text-muted-foreground text-sm">
          Profile details sync from Gideon and are read-only here. Change name, email, status, or
          dates in Gideon.
        </p>
        <Grid cols={{ base: '1', md: '2' }} gap="4">
          {/* Name Field */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.name')}</Label>
            <p className="text-sm">{employee.user.name ?? '—'}</p>
          </Stack>

          {/* Email Field (login email) */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.email')}</Label>
            <p className="text-sm">{employee.user.email ?? '—'}</p>
          </Stack>

          {/* Job Title Field */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.jobTitle')}</Label>
            <p className="text-sm">{employee.jobTitle ?? '—'}</p>
          </Stack>

          {/* Department Field */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.department')}</Label>
            <p className="text-sm">{employee.department ?? '—'}</p>
          </Stack>

          {/* Status Field */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.status')}</Label>
            <p className="text-sm">{statusOptionLabel(status, t)}</p>
          </Stack>

          {/* Onboard Date Field */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.onboardDate')}</Label>
            <p className="text-sm">
              {employee.onboardDate
                ? format(new Date(employee.onboardDate), 'PPP')
                : t('employeeDetails.notSet')}
            </p>
          </Stack>

          {/* Offboard Date Field */}
          <Stack gap="sm">
            <Label>{t('employeeDetails.offboardDate')}</Label>
            <p className="text-sm">
              {employee.offboardDate
                ? format(new Date(employee.offboardDate), 'PPP')
                : t('employeeDetails.notSet')}
            </p>
          </Stack>
        </Grid>
      </Stack>
    </Section>
  );
};
