import { useEffect, useRef, useState } from 'react'
import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js'
import LoadingSpinner from './LoadingSpinner'
import { X } from './icons'
import { useT } from '../lib/i18n'

interface Props {
  publishableKey: string
  clientSecret: string
  sessionId: string
  title?: string
  /** Called by Stripe when the customer completes payment in the embedded form. */
  onComplete: (sessionId: string) => void
  /** Called when the user dismisses the modal (X / overlay click). */
  onClose: () => void
}

// StripeCheckoutModal mounts Stripe's Embedded Checkout in an iframe inside
// our own modal so the user never leaves MarsShare. Completion is signalled
// via the onComplete callback (we configured the session with
// redirect_on_completion=never on the backend).
export default function StripeCheckoutModal({
  publishableKey,
  clientSecret,
  sessionId,
  title,
  onComplete,
  onClose,
}: Props) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const checkoutRef = useRef<StripeEmbeddedCheckout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const stripe = await loadStripe(publishableKey)
        if (!stripe) throw new Error('Failed to load Stripe.js')
        if (cancelled) return

        const instance = await stripe.initEmbeddedCheckout({
          clientSecret,
          onComplete: () => onComplete(sessionId),
        })
        if (cancelled) {
          instance.destroy()
          return
        }
        checkoutRef.current = instance
        if (containerRef.current) {
          instance.mount(containerRef.current)
          setReady(true)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Failed to load checkout')
      }
    })()

    return () => {
      cancelled = true
      try {
        checkoutRef.current?.destroy()
      } catch {
        // ignore — already destroyed
      }
      checkoutRef.current = null
    }
    // clientSecret uniquely identifies a session; re-mount only if it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSecret, publishableKey])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-elevation-3 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-surface-on">
            {title ?? t('wallet.cashRechargeTitle')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-variant text-surface-on-variant"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="p-6 text-sm text-error text-center">{error}</div>
          ) : (
            <>
              {!ready && <LoadingSpinner className="py-12" />}
              <div ref={containerRef} className="min-h-[200px]" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
