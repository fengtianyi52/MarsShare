import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import type { Post } from '../types'
import UserAvatar from './UserAvatar'
import VipBadge from './VipBadge'
import BannedBadge from './BannedBadge'
import MarkdownRenderer from './MarkdownRenderer'
import { useT } from '../lib/i18n'

interface Props {
  open: boolean
  post: Post
  isPending: boolean
  errorMessage?: string
  onClose: () => void
  onSubmit: (content: string) => void
}

export default function RepostDialog({ open, post, isPending, errorMessage, onClose, onSubmit }: Props) {
  const t = useT()
  const [content, setContent] = useState('')
  const originalPost = post.original_post ?? post

  useEffect(() => {
    if (open) {
      setContent('')
    }
  }, [open, post.id])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !isPending && onClose()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="w-full max-w-xl rounded bg-surface p-6 shadow-elevation-16"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <h2 className="text-lg font-semibold text-surface-on">{t('post.repostDialog.title')}</h2>
            <p className="mt-1 text-sm text-surface-on-variant">{t('post.repostDialog.desc')}</p>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('post.repostDialog.placeholder')}
              rows={5}
              className="mt-4 w-full resize-none rounded bg-surface-variant px-4 py-3 text-sm text-surface-on focus:outline-none focus:ring-2 focus:ring-primary/30"
            />

            <div className="mt-4 rounded border border-divider bg-surface-variant/50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <UserAvatar src={originalPost.author.avatar_url} name={originalPost.author.display_name} size="sm" />
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1 truncate text-sm font-medium text-surface-on">
                    {originalPost.author.display_name}
                    <VipBadge user={originalPost.author} />
                    <BannedBadge user={originalPost.author} />
                  </div>
                  <div className="truncate text-xs text-surface-on-variant">@{originalPost.author.username}</div>
                </div>
              </div>
              <MarkdownRenderer content={originalPost.content || t('post.originalEmpty')} className="text-sm text-surface-on-variant" />
            </div>

            {errorMessage && <p className="mt-3 text-sm text-error">{errorMessage}</p>}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded px-4 py-2 text-sm font-medium uppercase tracking-wider text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => onSubmit(content.trim())}
                disabled={!content.trim() || isPending}
                className="rounded bg-primary px-6 py-2 text-sm font-medium uppercase tracking-wider text-primary-on shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {isPending ? t('post.repostDialog.submitting') : t('post.repostDialog.submit')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
