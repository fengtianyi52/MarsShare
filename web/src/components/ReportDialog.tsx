import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { createReport } from '../lib/api'
import type { CreateReportReq } from '../types'
import { Flag, X, CheckCircle2, AlertTriangle } from './icons'
import { useT, type MessageKey } from '../lib/i18n'

interface Props {
  open: boolean
  targetType: CreateReportReq['target_type']
  targetId: string
  // 用于在标题里显示被举报的对象，例如 "举报「张三的帖子」"
  targetLabel?: string
  onClose: () => void
}

const REASON_PRESETS: { value: string; labelKey: MessageKey }[] = [
  { value: '垃圾营销 / 广告', labelKey: 'report.reason.spam' },
  { value: '辱骂 / 人身攻击', labelKey: 'report.reason.abuse' },
  { value: '色情 / 低俗', labelKey: 'report.reason.porn' },
  { value: '虚假信息 / 欺诈', labelKey: 'report.reason.fraud' },
  { value: '侵权 / 抄袭', labelKey: 'report.reason.copyright' },
  { value: '违法违规', labelKey: 'report.reason.illegal' },
  { value: 'other', labelKey: 'report.reason.other' },
]

const TARGET_TYPE_LABEL_KEY: Record<CreateReportReq['target_type'], MessageKey> = {
  post: 'report.target.post',
  comment: 'report.target.comment',
  user: 'report.target.user',
}

export default function ReportDialog({
  open,
  targetType,
  targetId,
  targetLabel,
  onClose,
}: Props) {
  const t = useT()
  const [reasonChoice, setReasonChoice] = useState<string>(REASON_PRESETS[0].value)
  const [extra, setExtra] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const targetTypeLabel = useMemo(() => t(TARGET_TYPE_LABEL_KEY[targetType]), [t, targetType])

  // Reset state whenever the dialog reopens for a new target.
  useEffect(() => {
    if (open) {
      setReasonChoice(REASON_PRESETS[0].value)
      setExtra('')
      setSubmitted(false)
    }
  }, [open, targetId])

  const mutation = useMutation({
    mutationFn: () => {
      const isOther = reasonChoice === 'other'
      const reason = isOther
        ? extra.trim() || t('report.reason.other')
        : extra.trim()
          ? `${reasonChoice} - ${extra.trim()}`
          : reasonChoice
      return createReport({ target_type: targetType, target_id: targetId, reason })
    },
    onSuccess: () => {
      setSubmitted(true)
      // Auto-close after a short success animation.
      window.setTimeout(() => {
        onClose()
      }, 1400)
    },
  })

  const handleSubmit = () => {
    if (mutation.isPending || submitted) return
    if (reasonChoice === 'other' && !extra.trim()) return
    mutation.mutate()
  }

  const handleClose = () => {
    if (mutation.isPending) return
    onClose()
  }

  // Render via Portal so the backdrop covers the whole viewport even when the
  // dialog is mounted inside a transformed ancestor (e.g. PostCard's
  // motion.article with layout=true creates a new containing block, which
  // would otherwise clip our `fixed inset-0` to the card's bounding box).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-md mx-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
              <h2 className="inline-flex items-center gap-2 text-base font-medium text-surface-on">
                <Flag className="h-4 w-4" aria-hidden />
                {t('report.title', { targetType: targetTypeLabel })}
              </h2>
              <button
                onClick={handleClose}
                aria-label={t('common.close')}
                disabled={mutation.isPending}
                className="p-1 text-surface-on-variant hover:text-error rounded disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="px-5 py-4">
              {submitted ? (
                <div className="flex flex-col items-center gap-2 py-6">
                  <CheckCircle2 className="h-10 w-10 text-success" aria-hidden />
                  <p className="text-sm text-surface-on">{t('report.success')}</p>
                </div>
              ) : (
                <>
                  {targetLabel && (
                    <p className="text-xs text-surface-on-variant mb-3 truncate" title={targetLabel}>
                      {t('report.targetLabel', { label: targetLabel })}
                    </p>
                  )}

                  <p className="text-xs text-surface-on-variant mb-2">{t('report.pickReason')}</p>
                  <div className="space-y-1.5">
                    {REASON_PRESETS.map((r) => (
                      <label
                        key={r.value}
                        className={clsx(
                          'flex items-center gap-2 px-3 py-2 rounded text-sm cursor-pointer transition-colors',
                          reasonChoice === r.value
                            ? 'bg-primary/10 text-primary'
                            : 'text-surface-on hover:bg-surface-variant',
                        )}
                      >
                        <input
                          type="radio"
                          name="report-reason"
                          value={r.value}
                          checked={reasonChoice === r.value}
                          onChange={() => setReasonChoice(r.value)}
                          className="accent-primary"
                        />
                        <span>{t(r.labelKey)}</span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-3">
                    <label className="text-xs text-surface-on-variant">
                      {t('report.extra')} {reasonChoice === 'other' && <span className="text-error">*</span>}
                    </label>
                    <textarea
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder={reasonChoice === 'other' ? t('report.extraRequired') : t('common.optional')}
                      className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2 resize-none"
                    />
                    <p className="text-[10px] text-surface-on-variant text-right mt-0.5">
                      {extra.length} / 500
                    </p>
                  </div>

                  {mutation.isError && (
                    <p className="inline-flex items-center gap-1 text-xs text-error mt-2">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      {(mutation.error as Error).message || t('report.submitFailed')}
                    </p>
                  )}
                </>
              )}
            </div>

            {!submitted && (
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-divider">
                <button
                  onClick={handleClose}
                  disabled={mutation.isPending}
                  className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={mutation.isPending || (reasonChoice === 'other' && !extra.trim())}
                  className="px-6 py-2 bg-error text-white rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  {mutation.isPending ? t('report.submitting') : t('report.submit')}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
