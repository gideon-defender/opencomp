'use client';

import { Badge } from '@gideon-defender/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import { Skeleton } from '@gideon-defender/ui/skeleton';
import { AlertTriangle, ArrowRight, CheckCircle2, CloudOff, Lock, Unplug } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export const CHECKR_SLUG = 'checkr';
export const CHECKR_NAME = 'Checkr';
export const CHECKR_CATEGORY = 'HR & People';
export const CHECKR_DESCRIPTION = 'Background checks and candidate identity provisioning';
const CHECKR_LOGO = 'https://img.logo.dev/checkr.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ';

export interface CheckrReadiness {
  ready: boolean;
  message?: string;
}

// Fetch state of the readiness probe. The badge must never assert a settled
// state for an unsettled fetch: loading renders a placeholder, a failed fetch
// renders Unavailable, and only a settled fetch renders Ready / Setup
// required / Not configured.
export type CheckrReadinessStatus = 'loading' | 'error' | 'loaded';

export function CheckrStatusBadge({
  readiness,
  status,
}: {
  readiness?: CheckrReadiness;
  status: CheckrReadinessStatus;
}) {
  if (status === 'loading') {
    return (
      <Skeleton
        className="h-[18px] w-24 rounded-full"
        role="status"
        aria-label="Checking Checkr status"
      />
    );
  }
  if (status === 'error') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
        <CloudOff className="h-3 w-3" aria-hidden />
        Unavailable
      </Badge>
    );
  }
  if (readiness?.ready) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0">
        <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden />
        Ready
      </Badge>
    );
  }
  if (readiness) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Setup required
      </Badge>
    );
  }
  // Settled without data. The probe fetcher throws on empty responses, so this
  // path only covers a missing probe (e.g. no org id). Keep the layout stable
  // with a neutral badge instead of collapsing with no badge at all. Viewers
  // without status permission never reach this path — the card renders
  // Restricted for them.
  return (
    <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
      <Unplug className="h-3 w-3" aria-hidden />
      Not configured
    </Badge>
  );
}

interface CheckrCatalogCardProps {
  orgId: string;
  readiness?: CheckrReadiness;
  readinessStatus: CheckrReadinessStatus;
  canReadStatus: boolean;
}

export function CheckrCatalogCard({
  orgId,
  readiness,
  readinessStatus,
  canReadStatus,
}: CheckrCatalogCardProps) {
  // Status the viewer is allowed to see. Viewers without status permission get
  // no readiness at all — the card renders Restricted instead of guessing.
  // Stale data never shows either: only a settled fetch drives the badge,
  // the title icon, and the message.
  const visibleReadiness = canReadStatus && readinessStatus === 'loaded' ? readiness : undefined;

  return (
    <Link
      href={`/${orgId}/integrations/${CHECKR_SLUG}`}
      aria-label="Open Checkr — background checks and screening details"
      className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="relative flex h-full cursor-pointer flex-col overflow-hidden transition-all hover:border-primary/20 hover:shadow-sm group-hover:border-primary/30 group-hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
              <Image
                src={CHECKR_LOGO}
                alt="Checkr logo"
                width={32}
                height={32}
                unoptimized
                className="rounded-md object-contain"
              />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                {CHECKR_NAME}
                {visibleReadiness?.ready && (
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                )}
                {visibleReadiness && !visibleReadiness.ready && (
                  <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                )}
              </CardTitle>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="text-xs text-muted-foreground">{CHECKR_CATEGORY}</p>
                {canReadStatus ? (
                  <CheckrStatusBadge readiness={readiness} status={readinessStatus} />
                ) : (
                  <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
                    <Lock className="h-3 w-3" aria-hidden />
                    Restricted
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex h-full flex-col">
          <div className="flex-1 space-y-2">
            <CardDescription className="line-clamp-2 text-sm leading-relaxed">
              {CHECKR_DESCRIPTION}
            </CardDescription>
            {visibleReadiness && !visibleReadiness.ready && visibleReadiness.message && (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {visibleReadiness.message}
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end gap-1.5 border-t border-border/50 pt-3 text-xs font-medium text-primary">
            <span>View details</span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </div>
        </CardContent>
        <div
          className="pointer-events-none absolute inset-0 rounded-xl bg-primary/5 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </Card>
    </Link>
  );
}
