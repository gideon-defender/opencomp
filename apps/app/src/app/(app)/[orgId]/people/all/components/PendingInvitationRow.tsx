'use client';

import type { Invitation } from '@db';
import { Badge } from '@gideon-defender/ui/badge';
import { TableCell, TableRow } from '@gideon-defender/ui/table';

interface PendingInvitationRowProps {
  invitation: Invitation & {
    role: string;
    createdAt?: Date;
  };
  // Historical OpenComp invitations remain read-only.
  /** How many requirement columns the table renders (one dash per column). */
  requirementColumnCount?: number;
}

export function PendingInvitationRow({
  invitation,
  requirementColumnCount = 1,
}: PendingInvitationRowProps) {
  const roles = Array.isArray(invitation.role)
    ? invitation.role
    : typeof invitation.role === 'string' && invitation.role.includes(',')
      ? invitation.role.split(',')
      : [invitation.role];

  return (
    <TableRow>
      {/* NAME */}
      <TableCell>
        <div className="min-w-0">
          <span>{invitation.email}</span>
        </div>
      </TableCell>

      {/* STATUS */}
      <TableCell>
        <Badge variant="outline">Pending</Badge>
      </TableCell>

      {/* ROLE */}
      <TableCell>
        <div className="w-[160px]">
          <div className="flex flex-wrap gap-1">
            {roles.map((role: string) => (
              <Badge key={role} variant="outline">
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </Badge>
            ))}
          </div>
        </div>
      </TableCell>

      {/* ONBOARDED */}
      <TableCell>
        <span className="text-sm text-muted-foreground">—</span>
      </TableCell>

      {/* OFFBOARDED */}
      <TableCell>
        <span className="text-sm text-muted-foreground">—</span>
      </TableCell>

      {/* Requirement columns — never applicable before the invite is accepted */}
      {Array.from({ length: requirementColumnCount }).map((_, i) => (
        <TableCell key={i}>
          <span className="text-sm text-muted-foreground">—</span>
        </TableCell>
      ))}

      {/* ACTIONS (read-only; historical OpenComp invitations) */}
      <TableCell>
        <div className="flex justify-center">
          <span
            className="text-sm text-muted-foreground"
            title="Historical OpenComp invitation; new access is managed in Gideon"
          >
            —
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}
