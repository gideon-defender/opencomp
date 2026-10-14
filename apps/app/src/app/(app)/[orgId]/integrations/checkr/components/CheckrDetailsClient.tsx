'use client';

import { Button } from '@gideon-defender/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import { ArrowRight, Info, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { StartBackgroundCheckDialog } from '../../../people/all/components/StartBackgroundCheckDialog';
import {
  CandidateScreenings,
  type CandidateScreeningsResponse,
} from '../../../people/components/CandidateScreenings';
import { CheckrStatusBadge, type CheckrReadiness } from '../../components/CheckrCatalogCard';

interface CheckrDetailsClientProps {
  orgId: string;
  canStartScreening: boolean;
  canReadScreenings: boolean;
  initialScreenings?: CandidateScreeningsResponse;
  initialReadiness?: CheckrReadiness;
}

export function CheckrDetailsClient({
  orgId,
  canStartScreening,
  canReadScreenings,
  initialScreenings,
  initialReadiness,
}: CheckrDetailsClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Screening candidates never creates an account or grants access. A clear completed check
        creates a Gideon identity. A Gideon administrator grants OpenComp access separately.
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>
            Tenant Checkr account intake for candidate background checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canStartScreening && (
            <Button onClick={() => setDialogOpen(true)}>Start background check</Button>
          )}
          {canReadScreenings && (
            <Button variant="outline" asChild>
              <Link href={`/${orgId}/people?tab=candidates`}>
                View candidates
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Screenings</CardTitle>
          <CardDescription>
            Dispatch state only. Invitation sent is not a clear report or an identity result.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canReadScreenings ? (
            <CandidateScreenings organizationId={orgId} initialData={initialScreenings} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Screening details require background check read permission.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Identity provisioning
          </CardTitle>
          <CardDescription>IdP-owned. OpenComp never provisions identities.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Provisioning status is unavailable in OpenComp. Only a completed clear report creates an
            unassigned Gideon identity. Flagged results never create identities. The candidate
            appears here after normal directory sync or first login. Identity retry is a Gideon
            administrator operation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration and health</CardTitle>
          <CardDescription>
            Tenant Checkr account, credentials, and intake readiness.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canStartScreening ? (
            <p className="text-sm text-muted-foreground">
              Configuration details require background check permission.
            </p>
          ) : !initialReadiness ? (
            <p className="text-sm text-muted-foreground">
              Configuration status is unavailable. Reload the page to try again.
            </p>
          ) : (
            <div className="space-y-2">
              <CheckrStatusBadge readiness={initialReadiness} />
              {!initialReadiness.ready && initialReadiness.message && (
                <p className="text-sm text-muted-foreground">{initialReadiness.message}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Credentials stay server-managed and never appear here. Disabling intake does not
                stop existing IdP provisioning or delete evidence, identities, or access.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {canStartScreening && (
        <StartBackgroundCheckDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          organizationId={orgId}
          canStart={canStartScreening}
        />
      )}
    </div>
  );
}
