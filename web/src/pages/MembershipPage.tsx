import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  createStripeCheckout,
  getPlans,
  getStripeConfig,
  getStripeOrder,
  getWallet,
  purchaseMembership,
  redeemCode,
} from '../lib/api'
import AppShell from '../components/layout/AppShell'
import LoadingSpinner from '../components/LoadingSpinner'
import StripeCheckoutModal from '../components/StripeCheckoutModal'
import { Check, Crown } from '../components/icons'
import clsx from 'clsx'
import { useT } from '../lib/i18n'
import { useToast, useConfirm, useFormatApiError } from '../lib/notify'
import type { UserMembership } from '../types'

interface CheckoutSession {
  clientSecret: string
  sessionId: string
  title: string
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${bytes} B`
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('zh-CN')
}

export default function MembershipPage() {
  const t = useT()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const { showConfirm } = useConfirm()
  const formatErr = useFormatApiError()
  const [code, setCode] = useState('')
  const [rechargeAmount, setRechargeAmount] = useState('10')
  const [checkout, setCheckout] = useState<CheckoutSession | null>(null)

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: getWallet,
  })

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: getPlans,
  })

  const { data: stripeCfg } = useQuery({
    queryKey: ['stripeConfig'],
    queryFn: getStripeConfig,
  })

  const stripeEnabled = !!stripeCfg?.enabled
  const stripeCurrency = (stripeCfg?.currency || 'usd').toUpperCase()
  const publishableKey = stripeCfg?.publishable_key || ''

  const memberships: UserMembership[] = wallet?.memberships ?? []
  const activeMemberships = memberships.filter((m) => m.is_active)
  const totalRemainingDays = activeMemberships.reduce((sum, m) => sum + m.remaining_days, 0)
  // Top tier = first active row (server returns active first, ordered by tier desc).
  const currentTier = activeMemberships[0] ?? null
  const overallEndsAt = currentTier
    ? new Date(Date.now() + totalRemainingDays * 86400000)
    : null

  const redeemMut = useMutation({
    mutationFn: () => redeemCode({ code }),
    onSuccess: () => {
      setCode('')
      qc.invalidateQueries({ queryKey: ['wallet'] })
      showToast({ type: 'success', message: t('wallet.redeemSuccess') })
    },
    onError: (err: unknown) => {
      showToast({ type: 'error', message: formatErr(err) })
    },
  })

  const [stripeError, setStripeError] = useState<string | null>(null)

  const stripeRechargeMut = useMutation({
    mutationFn: async (amountCents: number) => {
      setStripeError(null)
      const res = await createStripeCheckout({ kind: 'recharge', amount_cents: amountCents })
      return res
    },
    onSuccess: (res) => {
      setCheckout({
        clientSecret: res.client_secret,
        sessionId: res.session_id,
        title: t('wallet.cashRechargeTitle'),
      })
    },
    onError: (err: unknown) => {
      setStripeError(formatErr(err))
    },
  })

  const stripeMembershipMut = useMutation({
    mutationFn: async (planId: string) => {
      setStripeError(null)
      const res = await createStripeCheckout({ kind: 'membership', plan_id: planId })
      return { res, planId }
    },
    onSuccess: ({ res, planId }) => {
      const plan = plans?.find((p) => p.id === planId)
      setCheckout({
        clientSecret: res.client_secret,
        sessionId: res.session_id,
        title: plan ? plan.name : t('wallet.cashRechargeTitle'),
      })
    },
    onError: (err: unknown) => {
      setStripeError(formatErr(err))
    },
  })

  const purchaseMut = useMutation({
    mutationFn: (planId: string) => purchaseMembership({ plan_id: planId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      showToast({ type: 'success', message: t('wallet.purchaseSuccess') })
    },
    onError: async (err: unknown, planId) => {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE') {
        if (!stripeEnabled) {
          showToast({ type: 'error', message: t('wallet.insufficientNoStripe') })
          return
        }
        const ok = await showConfirm({
          title: t('wallet.insufficientNoStripe'),
          message: t('wallet.insufficientUseStripe'),
        })
        if (ok) stripeMembershipMut.mutate(planId)
        return
      }
      showToast({ type: 'error', message: formatErr(err) })
    },
  })

  // Stripe 完成后：先同步订单（无 webhook 也能履约），然后整页刷新
  // 让顶部 AppShell、用户头像、所有缓存都拿到最新会员状态。
  const handleCheckoutComplete = async (sessionId: string) => {
    try {
      await getStripeOrder(sessionId)
    } catch {
      // ignore — webhook may have already updated state
    }
    setCheckout(null)
    showToast({ type: 'success', message: t('wallet.paymentSuccessHint') })
    // Small delay so the toast is visible briefly before reload.
    setTimeout(() => window.location.reload(), 600)
  }

  if (walletLoading) {
    return <AppShell><LoadingSpinner className="py-20" /></AppShell>
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Membership status card */}
        <div
          className={clsx(
            'rounded p-6 mb-6 shadow-elevation-2',
            currentTier ? 'bg-primary text-primary-on' : 'bg-surface text-surface-on',
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className={clsx('text-xs uppercase tracking-wider', currentTier ? 'opacity-80' : 'text-surface-on-variant')}>
                {t('membership.statusTitle')}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Crown className="h-6 w-6 shrink-0" aria-hidden />
                <p className="text-2xl font-bold truncate">
                  {currentTier ? currentTier.plan_name : t('membership.statusFree')}
                </p>
              </div>
              {currentTier ? (
                <>
                  <p className={clsx('text-xs mt-2', 'opacity-80')}>
                    {t('membership.expiresOn', { date: overallEndsAt ? formatDate(overallEndsAt.toISOString()) : '—' })}
                  </p>
                  <p className={clsx('text-xs', 'opacity-70')}>
                    {t('membership.remainingDays', { days: totalRemainingDays })}
                  </p>
                </>
              ) : (
                <p className="text-xs text-surface-on-variant mt-2">{t('membership.statusFreeHint')}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className={clsx('text-xs uppercase tracking-wider', currentTier ? 'opacity-80' : 'text-surface-on-variant')}>
                {t('wallet.balance')}
              </p>
              <p className="text-2xl font-bold mt-1">{wallet?.balance?.toFixed(2) ?? '0.00'}</p>
              <p className={clsx('text-xs', currentTier ? 'opacity-60' : 'text-surface-on-variant')}>
                {t('wallet.credits')}
              </p>
            </div>
          </div>
        </div>

        {/* Stripe error banner — surfaces 422/4xx messages from the backend */}
        {stripeError && (
          <div className="mb-6 rounded border border-error bg-error/10 px-4 py-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-error">{t('wallet.paymentFailedTitle')}</p>
              <p className="text-xs text-error mt-1 break-words">{stripeError}</p>
            </div>
            <button
              onClick={() => setStripeError(null)}
              className="shrink-0 text-xs text-error hover:underline"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        {/* Membership stack — only when user has more than one row */}
        {memberships.length > 0 && (
          <div className="bg-surface rounded shadow-elevation-1 p-4 mb-6">
            <h2 className="text-sm font-medium text-surface-on mb-3">{t('membership.stackTitle')}</h2>
            <p className="text-xs text-surface-on-variant mb-3">{t('membership.stackHint')}</p>
            <ul className="space-y-2">
              {memberships.map((m, idx) => {
                const isCurrent = idx === 0 && m.is_active
                return (
                  <li
                    key={m.id}
                    className={clsx(
                      'rounded border px-3 py-2 flex items-center justify-between gap-2',
                      isCurrent
                        ? 'border-primary bg-primary/5'
                        : m.is_active
                          ? 'border-outline-variant bg-surface'
                          : 'border-outline-variant opacity-60',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-surface-on truncate">{m.plan_name}</p>
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-on uppercase">
                            {t('membership.current')}
                          </span>
                        )}
                        {!m.is_active && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-variant text-surface-on-variant uppercase">
                            {t('membership.exhausted')}
                          </span>
                        )}
                        {m.is_active && !isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-variant text-surface-on-variant uppercase">
                            {t('membership.queued')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-on-variant">
                        {t('membership.lineItem', {
                          remaining: m.remaining_days,
                          duration: m.duration_days,
                          storage: formatBytes(m.plan_storage_bytes),
                        })}
                      </p>
                    </div>
                    <div className="text-right text-xs text-surface-on-variant shrink-0">
                      {formatDate(m.created_at)}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Stripe cash recharge */}
        {stripeEnabled && (
          <div className="bg-surface rounded shadow-elevation-1 p-4 mb-6">
            <h2 className="text-sm font-medium text-surface-on mb-3">
              {t('wallet.cashRechargeTitle')}
            </h2>
            <p className="text-xs text-surface-on-variant mb-3">
              {t('wallet.cashRechargeHint', { currency: stripeCurrency })}
            </p>
            <div className="flex gap-2 items-stretch">
              <div className="flex-1 flex items-center gap-1 bg-surface-variant rounded px-3 border border-outline focus-within:border-primary focus-within:border-2">
                <span className="text-sm text-surface-on-variant">{stripeCurrency}</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  className="flex-1 bg-transparent py-2 text-sm focus:outline-none"
                  placeholder="10"
                />
              </div>
              <button
                onClick={() => {
                  const amount = Math.round(Number(rechargeAmount) * 100)
                  if (!Number.isFinite(amount) || amount <= 0) {
                    showToast({ type: 'error', message: t('wallet.invalidAmount') })
                    return
                  }
                  stripeRechargeMut.mutate(amount)
                }}
                disabled={stripeRechargeMut.isPending}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {stripeRechargeMut.isPending ? '...' : t('wallet.rechargeNow')}
              </button>
            </div>
            {stripeRechargeMut.isError && (
              <p className="text-xs text-error mt-2">{formatErr(stripeRechargeMut.error)}</p>
            )}
          </div>
        )}

        {/* Redeem code */}
        <div className="bg-surface rounded shadow-elevation-1 p-4 mb-6">
          <h2 className="text-sm font-medium text-surface-on mb-3">{t('wallet.redeemTitle')}</h2>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('wallet.redeemPlaceholder')}
              className="flex-1 bg-surface rounded px-4 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              onKeyDown={(e) => e.key === 'Enter' && code.trim() && redeemMut.mutate()}
            />
            <button
              onClick={() => redeemMut.mutate()}
              disabled={!code.trim() || redeemMut.isPending}
              className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
            >
              {redeemMut.isPending ? '...' : t('wallet.redeemButton')}
            </button>
          </div>
          {redeemMut.isError && (
            <p className="text-xs text-error mt-2">{formatErr(redeemMut.error)}</p>
          )}
        </div>

        {/* Membership plans */}
        {plans && plans.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-surface-on mb-3">{t('wallet.plans')}</h2>
            <p className="text-xs text-surface-on-variant mb-3">{t('membership.stackPurchaseHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <div key={plan.id} className="bg-surface rounded shadow-elevation-1 p-5 flex flex-col">
                  <h3 className="text-lg font-bold text-surface-on">{plan.name}</h3>
                  <p className="text-sm text-surface-on-variant mt-1">{plan.description}</p>
                  <div className="mt-3">
                    <span className="text-2xl font-bold text-primary">{plan.price}</span>
                    <span className="text-sm text-surface-on-variant ml-1">{t('wallet.credits')}</span>
                  </div>
                  <p className="text-xs text-surface-on-variant mt-1">{t('wallet.durationDays', { days: plan.duration_days })}</p>
                  {plan.features && (
                    <ul className="mt-3 space-y-1 flex-1">
                      {plan.features.map((f, i) => (
                        <li key={i} className="text-xs text-surface-on-variant flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    onClick={async () => {
                      const ok = await showConfirm({
                        message: t('wallet.purchaseConfirm', { price: plan.price, name: plan.name }),
                      })
                      if (ok) purchaseMut.mutate(plan.id)
                    }}
                    disabled={purchaseMut.isPending || stripeMembershipMut.isPending}
                    className="mt-4 w-full py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
                  >
                    {t('wallet.purchase')}
                  </button>
                  {stripeEnabled && (
                    <button
                      onClick={() => stripeMembershipMut.mutate(plan.id)}
                      disabled={stripeMembershipMut.isPending}
                      className="mt-2 w-full py-2 bg-surface-variant text-surface-on rounded text-xs font-medium hover:bg-surface-variant/80 transition-all disabled:opacity-50"
                    >
                      {t('wallet.payWithStripe', { currency: stripeCurrency })}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transaction history */}
        {wallet?.ledger && wallet.ledger.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-surface-on mb-3">{t('wallet.transactions')}</h2>
            <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-surface-on-variant">
                    <th className="py-3 px-4 font-medium">{t('wallet.txnDescription')}</th>
                    <th className="py-3 px-4 font-medium w-24 text-right">{t('wallet.txnAmount')}</th>
                    <th className="py-3 px-4 font-medium w-24 text-right">{t('wallet.txnBalance')}</th>
                    <th className="py-3 px-4 font-medium w-28">{t('common.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.ledger.map((entry) => (
                    <tr key={entry.id} className="border-b border-divider">
                      <td className="py-3 px-4 text-surface-on">{entry.description}</td>
                      <td className={clsx(
                        'py-3 px-4 text-right font-medium',
                        entry.type === 'credit' ? 'text-primary' : 'text-error',
                      )}>
                        {entry.type === 'credit' ? '+' : '-'}{Math.abs(entry.amount).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-surface-on-variant">
                        {entry.balance_after.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-surface-on-variant">
                        {new Date(entry.created_at).toLocaleDateString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {checkout && publishableKey && (
        <StripeCheckoutModal
          publishableKey={publishableKey}
          clientSecret={checkout.clientSecret}
          sessionId={checkout.sessionId}
          title={checkout.title}
          onComplete={handleCheckoutComplete}
          onClose={() => setCheckout(null)}
        />
      )}
    </AppShell>
  )
}
