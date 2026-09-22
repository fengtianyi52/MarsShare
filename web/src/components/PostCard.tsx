import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { Post } from '../types'
import {
  deletePost,
  downloadObjectFile,
  likePost,
  repost as repostApi,
  transferAttachmentToDrive,
  unlikePost,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useToast, useConfirm } from '../lib/notify'
import UserAvatar from './UserAvatar'
import MarkdownRenderer from './MarkdownRenderer'
import RepostDialog from './RepostDialog'
import ContextMenu, { type ContextMenuItems } from './ContextMenu'
import RevisionHistoryDialog from './RevisionHistoryDialog'
import PostComposer from './PostComposer'
import PostImageGrid, { type PostImageSource } from './PostImageGrid'
import VipBadge from './VipBadge'
import BannedBadge from './BannedBadge'
import ReportDialog from './ReportDialog'

// Mime helper. Kept inline since only this file needs it.
function isImageMime(mime?: string): boolean {
  return Boolean(mime && mime.toLowerCase().startsWith('image/'))
}
import {
  Heart,
  MessageCircle,
  Repeat2,
  LinkIcon,
  Eye,
  Paperclip,
  CheckCircle2,
  AlertTriangle,
  MoreHorizontal,
  Pencil,
  Trash2,
  History,
  Flag,
  X,
} from './icons'

interface Props {
  post: Post
  showFull?: boolean
}

function timeAgo(dateStr: string, t: (k: any, v?: any) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('time.justNow')
  if (mins < 60) return t('time.minutesAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('time.hoursAgo', { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 30) return t('time.daysAgo', { n: days })
  return new Date(dateStr).toLocaleDateString()
}

function invalidatePostQueries(qc: QueryClient, postId: string) {
  const keys: Array<readonly string[]> = [
    ['feed'],
    ['publicFeed'],
    ['trending'],
    ['post', postId],
    ['comments', postId],
    ['notifications'],
    ['unreadCount'],
    ['userProfile'],
  ]

  for (const key of keys) {
    qc.invalidateQueries({ queryKey: key })
  }
}

// Walk a React Query cache value (any shape: { items: [...] }, { pages: [...] },
// or a single Post) and apply `transform` to every post matching `postId`.
function patchPostInCache(value: unknown, postId: string, transform: (post: Post) => Post): unknown {
  if (value == null) return value
  if (Array.isArray(value)) {
    return value.map((v) => patchPostInCache(v, postId, transform))
  }
  if (typeof value !== 'object') return value
  const obj = value as Record<string, unknown>

  // Single Post object — has id + content + author shape.
  if (typeof obj.id === 'string' && obj.id === postId && 'content' in obj && 'like_count' in obj) {
    return transform(obj as unknown as Post)
  }

  // Recurse into nested arrays/objects.
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [k, v] of Object.entries(obj)) {
    const updated = patchPostInCache(v, postId, transform)
    if (updated !== v) changed = true
    next[k] = updated
  }
  return changed ? next : value
}

export default function PostCard({ post, showFull = false }: Props) {
  const { isAuthenticated, user } = useAuth()
  const t = useT()
  const { showToast } = useToast()
  const { showConfirm } = useConfirm()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [likeAnimating, setLikeAnimating] = useState(false)
  const [repostDialogOpen, setRepostDialogOpen] = useState(false)
  const [copyDialog, setCopyDialog] = useState<{ url: string; ok: boolean } | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  // Navigates to the post detail page when the user clicks the markdown body,
  // but ignores clicks that originate from interactive content inside the body
  // (links, buttons, inputs) so embedded #tag# topic links work correctly and
  // we don't end up with invalid nested <a> tags.
  const handleBodyClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button, input, textarea, select, label')) return
    navigate(`/post/${post.id}`)
  }

  // Auto-dismiss toast after a few seconds.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(id)
  }, [toast])

  const canEdit = Boolean(
    user && (user.id === post.author.id || user.role === 'admin'),
  )
  const isEdited = Boolean(post.edited_at)

  const postUrl = `${window.location.origin}/post/${post.id}`

  const handleCopyLink = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(postUrl)
      ok = true
    } catch {
      ok = false
    }
    setCopyDialog({ url: postUrl, ok })
  }

  const liked = post.is_liked
  const likeCount = post.like_count
  const reposted = post.is_reposted
  const repostCount = post.repost_count

  // Split attachments into images (rendered as a 9-grid below the body) and
  // everything else (rendered as the existing paperclip chips with download
  // / transfer actions). Order is preserved within each group.
  const imageAttachments = post.attachments.filter((a) => isImageMime(a.mime_type))
  const fileAttachments = post.attachments.filter((a) => !isImageMime(a.mime_type))

  // Optimistically toggle is_liked / like_count across every cached query.
  const applyLikeOptimistic = (nextLiked: boolean) => {
    qc.getQueryCache().getAll().forEach((q) => {
      qc.setQueryData(q.queryKey, (old: unknown) =>
        patchPostInCache(old, post.id, (p) => ({
          ...p,
          is_liked: nextLiked,
          like_count: Math.max(0, p.like_count + (nextLiked ? 1 : -1)),
        })),
      )
    })
  }

  const likeMut = useMutation({
    mutationFn: (nextLiked: boolean) => (nextLiked ? likePost(post.id) : unlikePost(post.id)),
    onMutate: (nextLiked: boolean) => {
      applyLikeOptimistic(nextLiked)
      if (nextLiked) {
        setLikeAnimating(true)
        window.setTimeout(() => setLikeAnimating(false), 300)
      }
    },
    onError: (_err, nextLiked) => {
      // Revert.
      applyLikeOptimistic(!nextLiked)
    },
    onSettled: () => invalidatePostQueries(qc, post.id),
  })

  const handleLikeClick = () => {
    if (!isAuthenticated || likeMut.isPending) return
    likeMut.mutate(!post.is_liked)
  }

  const repostMut = useMutation({
    mutationFn: (content: string) => repostApi(post.id, { content }),
    onSuccess: () => {
      setRepostDialogOpen(false)
      invalidatePostQueries(qc, post.id)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: () => invalidatePostQueries(qc, post.id),
  })

  const openMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuPos({ x: rect.right, y: rect.bottom + 4 })
  }

  const buildPostMenu = (): ContextMenuItems => {
    const items: ContextMenuItems = []
    items.push({
      key: 'copy-link',
      label: t('post.copyLink'),
      icon: <LinkIcon className="h-4 w-4" />,
      onClick: handleCopyLink,
    })
    if (canEdit) {
      items.push('divider')
      items.push({
        key: 'edit',
        label: t('common.edit'),
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => setIsEditing(true),
      })
      items.push({
        key: 'delete',
        label: t('common.delete'),
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        onClick: async () => {
          const ok = await showConfirm({ message: t('post.confirmDelete'), danger: true })
          if (ok) deleteMut.mutate()
        },
      })
    }
    // Anyone logged in (and not the author) can report.
    if (isAuthenticated && !canEdit) {
      items.push('divider')
      items.push({
        key: 'report',
        label: t('post.report'),
        icon: <Flag className="h-4 w-4" />,
        danger: true,
        onClick: () => setReportOpen(true),
      })
    }
    if (isEdited) {
      items.push('divider')
      items.push({
        key: 'history',
        label: t('post.history'),
        icon: <History className="h-4 w-4" />,
        onClick: () => setHistoryOpen(true),
      })
    }
    return items
  }

  return (
    <>
      <motion.article
        layout
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="rounded bg-surface p-4 shadow-elevation-1"
      >
        {post.original_post && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-surface-on-variant">
            <Repeat2 className="h-3.5 w-3.5" aria-hidden />
            <span>{t('post.reposted', { name: post.author.display_name })}</span>
          </div>
        )}

        <div className="mb-3 flex items-center gap-3">
          <Link to={`/u/${post.author.username}`}>
            <UserAvatar src={post.author.avatar_url} name={post.author.display_name} size="md" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link to={`/u/${post.author.username}`} className="inline-flex items-center gap-1 text-sm font-medium text-surface-on hover:text-primary">
              {post.author.display_name}
              <VipBadge user={post.author} />
              <BannedBadge user={post.author} />
            </Link>
            <p className="text-xs text-surface-on-variant flex items-center gap-1.5">
              <span>@{post.author.username} · {timeAgo(post.created_at, t)}</span>
              {isEdited && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setHistoryOpen(true) }}
                  title={t('post.viewHistory')}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  · {t('post.edited')}
                </button>
              )}
            </p>
          </div>
          {post.visibility !== 'public' && (
            <span className="rounded-full bg-surface-variant px-2 py-0.5 text-xs text-surface-on-variant">
              {post.visibility === 'followers' ? t('post.onlyFollowers') : t('post.private')}
            </span>
          )}
          <button
            type="button"
            onClick={openMenu}
            aria-label={t('common.moreActions')}
            className="p-1 rounded text-surface-on-variant hover:bg-surface-variant hover:text-primary transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {isEditing ? (
          <PostComposer
            editingPost={post}
            onCancel={() => setIsEditing(false)}
            onSuccess={() => setIsEditing(false)}
          />
        ) : (
        <div onClick={handleBodyClick} className="block cursor-pointer">
          <MarkdownRenderer
            content={showFull ? post.content : post.content.slice(0, 500)}
            className="text-sm text-surface-on"
          />
          {!showFull && post.content.length > 500 && (
            <span className="text-sm text-primary">{t('post.expand')}</span>
          )}
        </div>
        )}

        {!isEditing && imageAttachments.length > 0 && (
          <div className="mt-3">
            <PostImageGrid
              images={imageAttachments.map<PostImageSource>((a) => ({
                key: `att-${a.id}`,
                // Prefer the resolved CDN/base_url that the backend joins
                // from the storage policy. Falling back to objectId routes
                // through the authenticated /api/files/{id}/preview proxy.
                // Skip src/objectId entirely for deleted attachments so the
                // grid renders the deleted overlay instead of trying to load.
                src: a.is_deleted ? undefined : a.url || undefined,
                objectId: a.is_deleted ? undefined : a.object_id,
                alt: a.file_name,
                status: a.is_deleted ? 'deleted' : 'ready',
              }))}
            />
          </div>
        )}

        {!isEditing && fileAttachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {fileAttachments.map((attachment) =>
              attachment.is_deleted ? (
                <div
                  key={attachment.id}
                  className="flex items-center gap-1.5 rounded bg-surface-variant/60 px-3 py-1.5 text-xs text-surface-on-variant/60"
                  title={t('post.attachment.deleted')}
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  <span className="max-w-[120px] truncate line-through">{attachment.file_name}</span>
                  <span className="ml-1">{t('post.attachment.deleted')}</span>
                </div>
              ) : (
                <div
                  key={attachment.id}
                  className="flex items-center gap-1.5 rounded bg-surface-variant px-3 py-1.5 text-xs text-surface-on-variant"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  <span className="max-w-[120px] truncate">{attachment.file_name}</span>
                  {isAuthenticated && (
                    <>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          try {
                            await downloadObjectFile(attachment.object_id, attachment.file_name)
                          } catch (err) {
                            showToast({ type: 'error', message: (err as Error).message || t('common.downloadFailed') })
                          }
                        }}
                        className="ml-1 text-primary hover:underline"
                        title={t('post.attachment.downloadFile')}
                      >
                        {t('post.attachment.download')}
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          try {
                            await transferAttachmentToDrive(attachment.id)
                            qc.invalidateQueries({ queryKey: ['driveTree'] })
                            setToast({ kind: 'success', msg: t('post.attachment.transferred') })
                          } catch (err) {
                            setToast({ kind: 'error', msg: (err as Error).message || t('post.attachment.transferFailed') })
                          }
                        }}
                        className="text-primary hover:underline"
                        title={t('post.attachment.transferTo')}
                      >
                        {t('post.attachment.transfer')}
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
          </div>
        )}

        {post.topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {post.topics.map((topic) => (
              <Link
                key={topic.id}
                to={`/topics/${topic.slug}`}
                className="rounded-full bg-primary-container/50 px-2 py-0.5 text-xs text-primary hover:text-primary/80"
              >
                #{topic.name}
              </Link>
            ))}
          </div>
        )}

        {post.original_post && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              // Let inner links/buttons handle their own navigation
              if ((e.target as HTMLElement).closest('a, button')) return
              e.stopPropagation()
              navigate(`/post/${post.original_post!.id}`)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                navigate(`/post/${post.original_post!.id}`)
              }
            }}
            className="mt-3 cursor-pointer rounded border border-divider bg-surface-variant/50 p-3 transition-colors hover:bg-surface-variant/80"
          >
            <div className="mb-1 flex items-center gap-2">
              <UserAvatar
                src={post.original_post.author.avatar_url}
                name={post.original_post.author.display_name}
                size="sm"
              />
              <span className="inline-flex items-center gap-1 text-sm font-medium text-surface-on">
                {post.original_post.author.display_name}
                <VipBadge user={post.original_post.author} />
                <BannedBadge user={post.original_post.author} />
              </span>
            </div>
            <MarkdownRenderer
              content={post.original_post.content.slice(0, 200)}
              className="text-sm text-surface-on-variant"
            />
          </div>
        )}

        <div className="mt-3 flex items-center gap-1 border-t border-divider pt-3">
          <button
            type="button"
            onClick={handleLikeClick}
            disabled={!isAuthenticated || likeMut.isPending}
            aria-label={liked ? t('common.unlike') : t('common.like')}
            className={clsx(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-all hover:bg-error/10 disabled:opacity-60',
              liked ? 'text-error' : 'text-surface-on-variant',
            )}
          >
            <Heart
              className={clsx('h-4 w-4 transition-transform', likeAnimating && 'animate-heart-beat')}
              fill={liked ? 'currentColor' : 'none'}
              aria-hidden
            />
            <span>{likeCount || ''}</span>
          </button>

          <Link
            to={`/post/${post.id}`}
            aria-label={t('post.comment.aria')}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-surface-on-variant hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            <span>{post.comment_count || ''}</span>
          </Link>

          <button
            type="button"
            onClick={() => isAuthenticated && !reposted && setRepostDialogOpen(true)}
            disabled={!isAuthenticated || reposted || repostMut.isPending}
            aria-label={t('post.repost.aria')}
            className={clsx(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-primary/10 disabled:opacity-60 transition-colors',
              reposted ? 'text-primary' : 'text-surface-on-variant hover:text-primary',
            )}
          >
            <Repeat2 className="h-4 w-4" aria-hidden />
            <span>{repostCount || ''}</span>
          </button>

          <span
            aria-label={t('post.view.aria')}
            title={t('post.viewCountTitle', { count: post.view_count || 0 })}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-surface-on-variant"
          >
            <Eye className="h-4 w-4" aria-hidden />
            <span>{post.view_count || 0}</span>
          </span>

          <button
            type="button"
            onClick={handleCopyLink}
            title={t('post.copyLink')}
            aria-label={t('post.copyLink')}
            className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-surface-on-variant hover:bg-surface-variant transition-colors"
          >
            <LinkIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </motion.article>

      {createPortal(
        <AnimatePresence>
        {copyDialog && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
            onClick={() => setCopyDialog(null)}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className="bg-surface rounded shadow-elevation-16 w-full max-w-sm mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex items-center gap-2 mb-3">
                {copyDialog.ok ? (
                  <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-warning" aria-hidden />
                )}
                <h3 className="text-base font-medium text-surface-on">
                  {copyDialog.ok ? t('post.copyLinkSuccess') : t('common.copyFailed')}
                </h3>
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={copyDialog.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-surface-variant rounded px-3 py-2 text-xs text-surface-on focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(copyDialog.url)
                      setCopyDialog({ url: copyDialog.url, ok: true })
                    } catch {
                      setCopyDialog({ url: copyDialog.url, ok: false })
                    }
                  }}
                  className="px-3 py-2 bg-primary text-primary-on rounded text-xs font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
                >
                  {t('common.copy')}
                </button>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setCopyDialog(null)}
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
      )}

      <RepostDialog
        open={repostDialogOpen}
        post={post}
        isPending={repostMut.isPending}
        errorMessage={repostMut.isError ? (repostMut.error as Error).message : undefined}
        onClose={() => {
          if (!repostMut.isPending) {
            setRepostDialogOpen(false)
          }
        }}
        onSubmit={(content) => repostMut.mutate(content)}
      />

      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={buildPostMenu()}
          onClose={() => setMenuPos(null)}
        />
      )}

      <RevisionHistoryDialog
        postId={post.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      <ReportDialog
        open={reportOpen}
        targetType="post"
        targetId={post.id}
        targetLabel={t('post.targetLabel.post', { name: post.author.display_name })}
        onClose={() => setReportOpen(false)}
      />

      {/* Transfer-to-drive toast (auto-dismissing) — rendered via Portal so
          its `fixed` positioning escapes PostCard's transform container. */}
      {createPortal(
        <AnimatePresence>
          {toast && (
            <motion.div
              key="transfer-toast"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.2 }}
              className={clsx(
                'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70]',
                'flex items-center gap-2 px-4 py-2.5 rounded shadow-elevation-8',
                'text-sm max-w-[90vw]',
                toast.kind === 'success'
                  ? 'bg-surface text-surface-on border border-success/40'
                  : 'bg-surface text-surface-on border border-error/40',
              )}
            >
              {toast.kind === 'success'
                ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" aria-hidden />
                : <AlertTriangle className="h-4 w-4 text-error shrink-0" aria-hidden />
              }
              <span className="truncate">{toast.msg}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label={t('common.close')}
                className="ml-1 p-0.5 text-surface-on-variant hover:text-error rounded shrink-0"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
