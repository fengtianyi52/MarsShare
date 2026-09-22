import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAdminStripeOrders } from '../../lib/api'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { CreditCard } from '../../components/icons'
import { useT } from '../../lib/i18n'

type StatusFilter = '' | 'pending' | 'paid' | 'failed' | 'canceled'

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-primary/15 text-primary',
  pending: 'bg-tertiary/15 text-tertiary',
  failed: 'bg-error/15 text-error',
  canceled: 'bg-surface-variant text-surface-on-variant',
}

function formatAmount(cents: number, currency: string): string {
  const value = cents / 100
  const upper = (currency || 'usd').toUpperCase()
  return `${value.toFixed(2)} ${upper}`
}

export default function AdminBillingOrdersPage() {
  const t = useT()
  const [status, setStatus] = useState<StatusFilter>('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['adminStripeOrders', status, cursor],
    queryFn: () => getAdminStripeOrders(status || undefined, cursor),
  })

  const items = data?.items ?? []

  const filters: { key: StatusFilter; label: string }[] = [
    { key: '', label: t('admin.orders.filterAll') },
    { key: 'paid', label: t('admin.orders.statusPaid') },
    { key: 'pending', label: t('admin.orders.statusPending') },
    { key: 'failed', label: t('admin.orders.statusFailed') },
    { key: 'canceled', label: t('admin.orders.statusCanceled') },
  ]

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-5">
          <CreditCard className="h-5 w-5" aria-hidden />
          {t('admin.orders.title')}
        </h1>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 border-b border-outline-variant">
          {filters.map((f) => (
            <button
              key={f.key || 'all'}
              onClick={() => {
                setStatus(f.key)
                setCursor(undefined)
              }}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                status === f.key
                  ? 'text-primary border-b-2 border-primary -mb-px'
                  : 'text-surface-on-variant hover:text-surface-on'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : items.length === 0 ? (
          <EmptyState icon={<CreditCard className="h-14 w-14" />} title={t('admin.orders.empty')} />
        ) : (
          <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider text-left text-surface-on-variant">
                  <th className="py-3 px-4 font-medium">{t('admin.orders.colUser')}</th>
                  <th className="py-3 px-4 font-medium w-24">{t('admin.orders.colKind')}</th>
                  <th className="py-3 px-4 font-medium w-40">{t('admin.orders.colDetail')}</th>
                  <th className="py-3 px-4 font-medium w-28 text-right">{t('admin.orders.colAmount')}</th>
                  <th className="py-3 px-4 font-medium w-24">{t('admin.orders.colStatus')}</th>
                  <th className="py-3 px-4 font-medium w-36">{t('admin.orders.colCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-b border-divider hover:bg-surface-variant/50 align-top">
                    <td className="py-3 px-4">
                      <p className="font-medium text-surface-on">{o.display_name || o.username}</p>
                      <p className="text-xs text-surface-on-variant">{o.user_email}</p>
                    </td>
                    <td className="py-3 px-4 text-surface-on-variant">
                      {o.kind === 'membership' ? t('admin.orders.kindMembership') : t('admin.orders.kindRecharge')}
                    </td>
                    <td className="py-3 px-4 text-surface-on-variant text-xs">
                      {o.plan_name ?? '—'}
                      <p className="font-mono opacity-60 truncate" title={o.session_id}>{o.session_id.slice(0, 22)}…</p>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-surface-on">
                      {formatAmount(o.amount_cents, o.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[o.status] ?? 'bg-surface-variant text-surface-on-variant'}`}>
                        {t(`admin.orders.status${o.status.charAt(0).toUpperCase() + o.status.slice(1)}`)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-surface-on-variant text-xs">
                      {new Date(o.created_at).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex justify-center mt-4 gap-2">
          {cursor && (
            <button
              onClick={() => setCursor(undefined)}
              className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
            >
              {t('admin.orders.firstPage')}
            </button>
          )}
          {data?.next_cursor && (
            <button
              onClick={() => setCursor(data.next_cursor)}
              disabled={isFetching}
              className="px-4 py-2 text-sm bg-primary text-primary-on rounded font-medium uppercase tracking-wider hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {t('common.nextPage')}
            </button>
          )}
        </div>
      </div>
    </AppShell>
  )
}
