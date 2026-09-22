import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AppShell from '../components/layout/AppShell'
import LoadingSpinner from '../components/LoadingSpinner'
import { Check } from '../components/icons'
import { getStripeOrder } from '../lib/api'
import { useT } from '../lib/i18n'

interface Props {
  variant: 'success' | 'cancel'
}

// Stripe redirects to /billing/success?session_id=cs_xxx after a successful
// checkout. The webhook is normally faster than the user, but to handle the
// race condition we poll the order status briefly before showing the result.
export default function BillingResultPage({ variant }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') ?? ''
  const [status, setStatus] = useState<'loading' | 'paid' | 'pending' | 'canceled'>(
    variant === 'cancel' ? 'canceled' : 'loading',
  )

  useEffect(() => {
    if (variant === 'cancel' || !sessionId) return
    let cancelled = false
    let attempts = 0

    const poll = async () => {
      attempts += 1
      try {
        const order = await getStripeOrder(sessionId)
        if (cancelled) return
        if (order.status === 'paid') {
          setStatus('paid')
          qc.invalidateQueries({ queryKey: ['wallet'] })
          qc.invalidateQueries({ queryKey: ['me'] })
          // Hard navigate so AppShell / user header / all caches see the
          // new membership state.
          setTimeout(() => window.location.assign('/membership'), 800)
          return
        }
        if (order.status === 'failed' || order.status === 'canceled') {
          setStatus('canceled')
          return
        }
      } catch {
        // ignore — order may not be persisted yet
      }
      if (attempts >= 6) {
        setStatus('pending')
        return
      }
      setTimeout(poll, 1500)
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [variant, sessionId, qc])

  const titleKey =
    status === 'paid'
      ? 'wallet.paymentSuccessTitle'
      : status === 'canceled'
        ? 'wallet.paymentCanceledTitle'
        : 'wallet.paymentPendingTitle'
  const hintKey =
    status === 'paid'
      ? 'wallet.paymentSuccessHint'
      : status === 'canceled'
        ? 'wallet.paymentCanceledHint'
        : 'wallet.paymentPendingHint'

  return (
    <AppShell>
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        {status === 'loading' ? (
          <LoadingSpinner className="py-12" />
        ) : (
          <>
            <div className={`inline-flex items-center justify-center h-16 w-16 rounded-full mb-4 ${
              status === 'paid' ? 'bg-primary text-primary-on' : 'bg-surface-variant text-surface-on-variant'
            }`}>
              <Check className="h-8 w-8" aria-hidden />
            </div>
            <h1 className="text-2xl font-bold text-surface-on">{t(titleKey)}</h1>
            <p className="text-sm text-surface-on-variant mt-2">{t(hintKey)}</p>
            <Link
              to="/membership"
              className="inline-block mt-6 px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
            >
              {t('wallet.backToWallet')}
            </Link>
          </>
        )}
      </div>
    </AppShell>
  )
}
