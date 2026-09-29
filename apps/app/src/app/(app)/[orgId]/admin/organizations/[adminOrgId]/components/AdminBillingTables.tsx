'use client';

import { formatDateLocale } from '@/lib/format';

import { Badge, Button, Text } from '@trycompai/design-system';
import { useLocale, useTranslations } from 'next-intl';
import type {
  AdminBillingCreditBalance,
  AdminBillingInvoice,
  AdminBillingSubscription,
} from './AdminBillingTypes';

type BillingTranslator = ReturnType<typeof useTranslations<'admin'>>;

function stripeStatusLabel(t: BillingTranslator, status: string): string {
  switch (status) {
    case 'active':
      return t('organizations.billingTables.statuses.active');
    case 'trialing':
      return t('organizations.billingTables.statuses.trialing');
    case 'past_due':
      return t('organizations.billingTables.statuses.pastDue');
    case 'canceled':
      return t('organizations.billingTables.statuses.canceled');
    case 'unpaid':
      return t('organizations.billingTables.statuses.unpaid');
    case 'incomplete':
      return t('organizations.billingTables.statuses.incomplete');
    case 'incomplete_expired':
      return t('organizations.billingTables.statuses.incompleteExpired');
    default:
      return status;
  }
}

function invoiceStatusLabel(t: BillingTranslator, status: string): string {
  switch (status) {
    case 'paid':
      return t('organizations.billingTables.statuses.paid');
    case 'open':
      return t('organizations.billingTables.statuses.open');
    case 'void':
      return t('organizations.billingTables.statuses.void');
    case 'uncollectible':
      return t('organizations.billingTables.statuses.uncollectible');
    case 'draft':
      return t('organizations.billingTables.statuses.draft');
    default:
      return status;
  }
}

function productLabel(t: BillingTranslator, productKey: string): string {
  switch (productKey) {
    case 'pentest':
      return t('organizations.billingTables.products.pentest');
    default:
      return t('organizations.billingTables.products.backgroundChecks');
  }
}

function formatDate(value: string | null, notAvailableLabel: string): string {
  return formatDateLocale(value) || notAvailableLabel;
}

function formatAmount(amount: number, currency: string, locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function SubscriptionRows({
  subscriptions,
  onCancel,
  onResume,
  loadingId,
}: {
  subscriptions: AdminBillingSubscription[];
  onCancel: (subscription: AdminBillingSubscription, immediate: boolean) => void;
  onResume: (subscription: AdminBillingSubscription) => void;
  loadingId: string | null;
}) {
  const t = useTranslations('admin');

  if (subscriptions.length === 0) {
    return <Text variant="muted">{t('organizations.billingTables.emptySubscriptions')}</Text>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-3">{t('organizations.billingTables.plan')}</th>
            <th className="px-4 py-3">{t('organizations.billingTables.status')}</th>
            <th className="px-4 py-3">{t('organizations.billingTables.usage')}</th>
            <th className="px-4 py-3">{t('organizations.billingTables.renews')}</th>
            <th className="px-4 py-3 text-right">{t('organizations.billingTables.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((subscription) => (
            <tr key={subscription.id} className="border-t">
              <td className="px-4 py-3 font-medium">{subscription.skuKey}</td>
              <td className="px-4 py-3">
                <Badge variant={subscription.stripeStatus === 'active' ? 'default' : 'outline'}>
                  {subscription.cancelAtPeriodEnd
                    ? t('organizations.billingTables.statuses.canceling')
                    : stripeStatusLabel(t, subscription.stripeStatus)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                {subscription.usedQuantity} / {subscription.includedQuantity}
              </td>
              <td className="px-4 py-3">
                {formatDate(
                  subscription.currentPeriodEnd,
                  t('organizations.billingTables.notAvailable'),
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  {subscription.cancelAtPeriodEnd ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={loadingId === subscription.id}
                      onClick={() => onResume(subscription)}
                    >
                      {t('organizations.billingTables.resume')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={loadingId === subscription.id}
                        onClick={() => onCancel(subscription, false)}
                      >
                        {t('organizations.billingTables.cancelLater')}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={loadingId === subscription.id}
                        onClick={() => onCancel(subscription, true)}
                      >
                        {t('organizations.billingTables.cancelNow')}
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CreditBalanceRows({ balances }: { balances: AdminBillingCreditBalance[] }) {
  const t = useTranslations('admin');

  if (balances.length === 0) {
    return <Text variant="muted">{t('organizations.billingTables.emptyCredits')}</Text>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {balances.map((balance) => (
        <div key={balance.id} className="rounded-lg border p-4">
          <Text size="sm" variant="muted">
            {productLabel(t, balance.productKey)}
          </Text>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{balance.balance}</div>
          <Text size="sm" variant="muted">
            {t('organizations.billingTables.grantedConsumed', {
              granted: balance.totalGranted,
              consumed: balance.totalConsumed,
            })}
          </Text>
        </div>
      ))}
    </div>
  );
}

export function InvoiceRows({
  invoices,
  onRetryLink,
  loadingId,
}: {
  invoices: AdminBillingInvoice[];
  onRetryLink: (invoice: AdminBillingInvoice) => void;
  loadingId: string | null;
}) {
  const t = useTranslations('admin');
  const locale = useLocale();

  if (invoices.length === 0) {
    return <Text variant="muted">{t('organizations.billingTables.emptyInvoices')}</Text>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-3">{t('organizations.billingTables.invoice')}</th>
            <th className="px-4 py-3">{t('organizations.billingTables.status')}</th>
            <th className="px-4 py-3">{t('organizations.billingTables.amount')}</th>
            <th className="px-4 py-3">{t('organizations.billingTables.created')}</th>
            <th className="px-4 py-3 text-right">{t('organizations.billingTables.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="border-t">
              <td className="px-4 py-3 font-medium">{invoice.number}</td>
              <td className="px-4 py-3">
                <Badge variant={invoice.status === 'paid' ? 'default' : 'outline'}>
                  {invoiceStatusLabel(t, invoice.status)}
                </Badge>
              </td>
              <td className="px-4 py-3">{formatAmount(invoice.amountDue, invoice.currency, locale)}</td>
              <td className="px-4 py-3">
                {formatDate(invoice.createdAt, t('organizations.billingTables.notAvailable'))}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  loading={loadingId === invoice.id}
                  onClick={() => onRetryLink(invoice)}
                >
                  {t('organizations.billingTables.recoveryLink')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
