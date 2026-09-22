import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from '../components/icons'
import { useT } from './i18n'
import { ApiError } from './api'

// Localised renderer for backend errors. Looks at ApiError.code first and
// pulls structured fields out of `data`; falls back to the raw message for
// codes we don't have a translation for.
export function formatApiError(err: unknown, t: ReturnType<typeof useT>): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'STRIPE_AMOUNT_TOO_SMALL': {
        const minCents = Number(err.data?.min_cents ?? 0)
        const currency = String(err.data?.currency ?? 'USD')
        return t('wallet.amountTooSmall', {
          min: (minCents / 100).toFixed(2),
          currency,
        })
      }
      case 'STRIPE_DISABLED':
        return t('wallet.stripeDisabled')
      case 'STRIPE_ERROR':
        // Stripe-relayed message — usually already human readable.
        return t('wallet.stripeError', { message: err.message })
      case 'INSUFFICIENT_BALANCE':
        return t('wallet.insufficientNoStripe')
    }
    return err.message
  }
  return (err as Error)?.message ?? String(err)
}

// Hook variant that captures the current `t` for callers that don't already
// have one in scope.
export function useFormatApiError() {
  const t = useT()
  return (err: unknown) => formatApiError(err, t)
}

// In-page replacement for window.alert / window.confirm.
//
// - useToast(): showToast({ type, message, duration? }) — non-blocking, auto dismiss
// - useConfirm(): showConfirm({ title?, message, confirmText?, cancelText?, danger? }): Promise<boolean>
//
// Both render via a single root NotifyProvider mounted at the very top of
// the app, so it works even from non-page modules (mutation callbacks, etc.).

// ─── Toast ────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info'

export interface ToastOptions {
  type?: ToastType
  message: string
  duration?: number // ms; 0 = sticky
}

interface ToastItem extends Required<ToastOptions> {
  id: number
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => number
  dismissToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within NotifyProvider')
  return ctx
}

// ─── Confirm ──────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

interface ConfirmContextValue {
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within NotifyProvider')
  return ctx
}

// ─── Provider ─────────────────────────────────────────────────────────────

let nextId = 1

export function NotifyProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const timersRef = useRef<Map<number, number>>(new Map())

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((it) => it.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (opts: ToastOptions) => {
      const id = nextId++
      const item: ToastItem = {
        id,
        type: opts.type ?? 'info',
        message: opts.message,
        duration: opts.duration ?? 4000,
      }
      setToasts((list) => [...list, item])
      if (item.duration > 0) {
        const timer = window.setTimeout(() => dismissToast(id), item.duration)
        timersRef.current.set(id, timer)
      }
      return id
    },
    [dismissToast],
  )

  const showConfirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve })
    })
  }, [])

  const handleConfirmAnswer = useCallback(
    (ok: boolean) => {
      if (!confirmState) return
      confirmState.resolve(ok)
      setConfirmState(null)
    },
    [confirmState],
  )

  // Cleanup outstanding timers on unmount.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
    }
  }, [])

  // Esc dismisses the confirm dialog as Cancel.
  useEffect(() => {
    if (!confirmState) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleConfirmAnswer(false)
      if (e.key === 'Enter') handleConfirmAnswer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmState, handleConfirmAnswer])

  const toastCtx = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  )
  const confirmCtx = useMemo<ConfirmContextValue>(
    () => ({ showConfirm }),
    [showConfirm],
  )

  return (
    <ToastContext.Provider value={toastCtx}>
      <ConfirmContext.Provider value={confirmCtx}>
        {children}

        {/* Toast stack — top-right, stacks vertically */}
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} onClose={() => dismissToast(item.id)} />
          ))}
        </div>

        {/* Confirm modal */}
        {confirmState && (
          <div
            className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4"
            onClick={() => handleConfirmAnswer(false)}
          >
            <div
              className="bg-surface rounded-2xl shadow-elevation-3 max-w-sm w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              {confirmState.title && (
                <h2 className="text-lg font-bold text-surface-on mb-2">{confirmState.title}</h2>
              )}
              <p className="text-sm text-surface-on-variant whitespace-pre-wrap break-words">
                {confirmState.message}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => handleConfirmAnswer(false)}
                  className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
                >
                  {confirmState.cancelText ?? t('common.cancel')}
                </button>
                <button
                  onClick={() => handleConfirmAnswer(true)}
                  className={`px-4 py-2 text-sm text-primary-on rounded uppercase tracking-wider font-medium shadow-elevation-1 hover:shadow-elevation-2 transition-all ${
                    confirmState.danger
                      ? 'bg-error hover:bg-error/90'
                      : 'bg-primary hover:bg-primary-dark'
                  }`}
                >
                  {confirmState.confirmText ?? t('common.confirmOk')}
                </button>
              </div>
            </div>
          </div>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}

// ─── Toast card ───────────────────────────────────────────────────────────

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const { type, message } = item
  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? AlertTriangle : Info
  const accent =
    type === 'success'
      ? 'border-primary text-primary'
      : type === 'error'
        ? 'border-error text-error'
        : 'border-outline text-surface-on'
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto bg-surface rounded-lg shadow-elevation-2 border-l-4 px-4 py-3 flex items-start gap-3 ${accent}`}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
      <p className="flex-1 text-sm text-surface-on whitespace-pre-wrap break-words">{message}</p>
      <button
        onClick={onClose}
        className="shrink-0 p-0.5 -mr-1 -mt-1 text-surface-on-variant hover:text-surface-on"
        aria-label="close"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
