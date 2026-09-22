import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { getPostRevisions } from '../lib/api'
import UserAvatar from './UserAvatar'
import VipBadge from './VipBadge'
import BannedBadge from './BannedBadge'
import MarkdownRenderer from './MarkdownRenderer'
import LoadingSpinner from './LoadingSpinner'
import { X, History, Paperclip, Clock } from './icons'
import { useT } from '../lib/i18n'

interface Props {
  postId: string
  open: boolean
  onClose: () => void
}

function formatTime(s: string): string {
  if (!s) return ''
  return new Date(s).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function RevisionHistoryDialog({ postId, open, onClose }: Props) {
  const t = useT()
  const { data: revisions, isLoading, isError, error } = useQuery({
    queryKey: ['postRevisions', postId],
    queryFn: () => getPostRevisions(postId),
    enabled: open,
  })

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-lg mx-4 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
              <h2 className="inline-flex items-center gap-2 text-base font-medium text-surface-on">
                <History className="h-4 w-4" aria-hidden />
                {t('post.history')}
              </h2>
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="p-1 text-surface-on-variant hover:text-error rounded"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
              {isLoading ? (
                <LoadingSpinner className="py-8" />
              ) : isError ? (
                <p className="text-sm text-error">
                  {t('common.loadingFailedWith', { message: (error as Error).message })}
                </p>
              ) : !revisions || revisions.length === 0 ? (
                <p className="text-sm text-surface-on-variant text-center py-8">
                  {t('post.history.empty')}
                </p>
              ) : (
                <ol className="relative space-y-5">
                  {revisions.map((rev, i) => (
                    <li key={rev.id} className="relative pl-6">
                      <span className="absolute left-1 top-2 h-2 w-2 rounded-full bg-primary" />
                      {i < revisions.length - 1 && (
                        <span className="absolute left-[7px] top-4 bottom-[-1.25rem] w-px bg-divider" />
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <UserAvatar
                          src={rev.editor.avatar_url}
                          name={rev.editor.display_name}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="inline-flex items-center gap-1 text-sm font-medium text-surface-on truncate">
                            {rev.editor.display_name}
                            <VipBadge user={rev.editor} />
                            <BannedBadge user={rev.editor} />
                          </p>
                          <p className="inline-flex items-center gap-1 text-xs text-surface-on-variant">
                            <Clock className="h-3 w-3" aria-hidden />
                            {t('post.history.beforeEdit', { time: formatTime(rev.created_at) })}
                          </p>
                        </div>
                      </div>
                      <div className="rounded bg-surface-variant/40 px-3 py-2.5 border border-divider">
                        {rev.content ? (
                          <MarkdownRenderer
                            content={rev.content}
                            className="text-sm text-surface-on"
                          />
                        ) : (
                          <p className="text-xs text-surface-on-variant italic">{t('post.history.emptyContent')}</p>
                        )}
                        {rev.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {rev.attachments.map((a, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 text-xs bg-surface px-2 py-0.5 rounded text-surface-on-variant"
                              >
                                <Paperclip className="h-3 w-3" aria-hidden />
                                <span className="max-w-[140px] truncate">{a.name}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="px-5 py-3 border-t border-divider flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
