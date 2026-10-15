'use client';

import { Card, CardContent } from '@gideon-defender/ui/card';
import { Stack, Text } from '@trycompai/design-system';
import { useState } from 'react';
import { PermissionMatrix } from '../../components/PermissionMatrix';

interface SystemRoleDetailProps {
  roleName: string;
  permissions: Record<string, string[]>;
  obligations: Record<string, boolean>;
  description: string;
}

export function SystemRoleDetail({
  roleName,
  permissions,
  obligations,
  description,
}: SystemRoleDetailProps) {
  const [currentObligations, setCurrentObligations] =
    useState<Record<string, boolean>>(obligations);
  const [prevRoleKey, setPrevRoleKey] = useState(roleName);
  const [prevObligations, setPrevObligations] = useState(obligations);
  // Resync when the parent passes new props — either because the user
  // navigated to a different built-in role, or because the page re-fetched
  // the same role's obligations. Adjust-during-render instead of an effect.
  if (prevRoleKey !== roleName || prevObligations !== obligations) {
    setPrevRoleKey(roleName);
    setPrevObligations(obligations);
    setCurrentObligations(obligations);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Stack gap="md">
          <Text size="sm" variant="muted">
            {description}
          </Text>
          <PermissionMatrix
            value={permissions}
            onChange={() => {}}
            obligations={currentObligations}
            disabled
          />
          <Text size="sm" variant="muted">
            Obligation assignments are managed in Gideon. This view is read-only.
          </Text>
        </Stack>
      </CardContent>
    </Card>
  );
}
