'use client';

import { Badge } from '@gideon-defender/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
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

export function CheckrStatusBadge({ readiness }: { readiness: CheckrReadiness }) {
  if (readiness.ready) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden />
        Ready
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Setup required
    </Badge>
  );
}

interface CheckrCatalogCardProps {
  orgId: string;
  readiness?: CheckrReadiness;
  canReadStatus: boolean;
}

export function CheckrCatalogCard({ orgId, readiness, canReadStatus }: CheckrCatalogCardProps) {
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
                {canReadStatus && readiness && <CheckrStatusBadge readiness={readiness} />}
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{CHECKR_CATEGORY}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex h-full flex-col">
          <div className="flex-1">
            <CardDescription className="line-clamp-2 text-sm leading-relaxed">
              {CHECKR_DESCRIPTION}
            </CardDescription>
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
