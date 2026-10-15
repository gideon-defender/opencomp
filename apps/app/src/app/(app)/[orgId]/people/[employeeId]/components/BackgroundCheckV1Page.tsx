'use client';

import { Paperclip, Zap } from 'lucide-react';
import { useState } from 'react';
import { BackgroundCheckAttachForm, type AttachFormValues } from './BackgroundCheckAttachForm';
import { BackgroundCheckOrderForm, type OrderFormValues } from './BackgroundCheckOrderForm';
import { BackgroundCheckPathCard } from './BackgroundCheckPathCard';
import { BackgroundCheckScopePanel } from './BackgroundCheckScopePanel';
import { BackgroundCheckStatusStrip } from './BackgroundCheckStatusStrip';

export type SelectedPath = 'order' | 'attach';

interface V1PageProps {
  selectedPath: SelectedPath;
  onSelectedPathChange: (next: SelectedPath) => void;

  // Status strip
  creditsUsed: number;
  creditsIncluded: number;
  planHref: string;
  canManageBilling: boolean;

  // Order
  orderValues: OrderFormValues;
  orderErrors: Partial<Record<keyof OrderFormValues, string>>;
  onOrderChange: (next: OrderFormValues) => void;
  onOrderSubmit: () => void;
  isOrderSubmitting: boolean;
  hasAllowance: boolean;

  // Attach
  attachValues: AttachFormValues;
  onAttachChange: (next: AttachFormValues) => void;
  onAttachSubmit: () => void;
  isAttachSubmitting: boolean;

  canRequest: boolean;
}

const PATH_ORDER: SelectedPath[] = ['order', 'attach'];

export function BackgroundCheckV1Page(props: V1PageProps) {
  const { selectedPath, onSelectedPathChange } = props;
  const [animationKey, setAnimationKey] = useState(0);

  const handleSelect = (next: SelectedPath) => {
    if (next === selectedPath) return;
    onSelectedPathChange(next);
    setAnimationKey((value) => value + 1);
  };

  const navigateRelative = (direction: 'next' | 'prev') => {
    const index = PATH_ORDER.indexOf(selectedPath);
    const length = PATH_ORDER.length;
    const nextIndex = (index + (direction === 'next' ? 1 : -1) + length) % length;
    handleSelect(PATH_ORDER[nextIndex]);
  };

  return (
    <div>
      <BackgroundCheckStatusStrip
        status={statusForStrip(props)}
        creditsUsed={props.creditsUsed}
        creditsIncluded={props.creditsIncluded}
        planHref={props.planHref}
        canManageBilling={props.canManageBilling}
      />

      <div
        className="mb-3 text-[11px] font-bold uppercase text-muted-foreground"
        style={{ letterSpacing: '0.08em' }}
      >
        How would you like to proceed?
      </div>

      <div
        role="radiogroup"
        aria-label="How would you like to proceed?"
        className="mb-6 grid gap-3 md:grid-cols-2"
      >
        <BackgroundCheckPathCard
          selected={selectedPath === 'order'}
          onSelect={() => handleSelect('order')}
          onNavigate={navigateRelative}
          icon={Zap}
          title="Order a new check"
          description="OpenComp runs the check end-to-end via our vendor."
          meta={<span className="text-muted-foreground">1 credit · 3–5 business days</span>}
        />
        <BackgroundCheckPathCard
          selected={selectedPath === 'attach'}
          onSelect={() => handleSelect('attach')}
          onNavigate={navigateRelative}
          icon={Paperclip}
          title="Attach an existing report"
          description="Upload a report from Checkr, Sterling, or another vendor."
          meta={<span className="text-muted-foreground">Free · Instant</span>}
        />
      </div>

      <div className="rounded-[var(--radius)] border bg-card p-5">
        <div key={animationKey} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
          {selectedPath === 'order' && (
            <BackgroundCheckOrderForm
              values={props.orderValues}
              errors={props.orderErrors}
              onChange={props.onOrderChange}
              onSubmit={props.onOrderSubmit}
              submitting={props.isOrderSubmitting}
              canSubmit={
                props.canRequest &&
                props.hasAllowance &&
                Boolean(props.orderValues.employeeName) &&
                Boolean(props.orderValues.employeeEmail)
              }
              disabledReason={
                !props.hasAllowance
                  ? "You're out of credits. Choose a plan to continue."
                  : undefined
              }
            />
          )}
          {selectedPath === 'attach' && (
            <BackgroundCheckAttachForm
              values={props.attachValues}
              onChange={props.onAttachChange}
              onSubmit={props.onAttachSubmit}
              submitting={props.isAttachSubmitting}
              canSubmit={
                props.canRequest &&
                Boolean(props.attachValues.vendor) &&
                Boolean(props.attachValues.file)
              }
            />
          )}
        </div>
      </div>

      <BackgroundCheckScopePanel />

      {!props.canRequest && (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">
            You don&apos;t have permission to take this action.
          </p>
        </div>
      )}
    </div>
  );
}

function statusForStrip(props: V1PageProps): 'not_started' {
  // The V1 page is only shown for the empty state; once a check exists, the
  // page renders the status view instead. So this is always "not_started".
  void props;
  return 'not_started';
}
