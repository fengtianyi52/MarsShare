import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Comment, DriveNode, PostAttachment } from '../types'
import { addComment, deleteComment, likeComment, unlikeComment } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useConfirm } from '../lib/notify'
import UserAvatar from './UserAvatar'
import VipBadge from './VipBadge'
import BannedBadge from './BannedBadge'
import MarkdownRenderer from './MarkdownRenderer'
import MarkdownEditor, { type EditorImage } from './MarkdownEditor'
import PostImageGrid, { type PostImageSource } from './PostImageGrid'
import DriveFilePicker from './DriveFilePicker'
import ReportDialog from './ReportDialog'
import { Heart, Paperclip, X, Flag, Trash2 } from './icons'

// Mime helper kept local to avoid pulling a util module just for this.
function isImageMime(mime?: string): boolean {
  return Boolean(mime && mime.toLowerCase().startsWith('image/'))
}

// Convert a comment's image attachments to PostImageSource entries that the
// 9-grid can lazy-fetch via objectId. Prefers the backend-resolved CDN URL
// (attachment.url) when the storage policy has a base_url configured.
function commentImagesFor(comment: Comment): PostImageSource[] {
  const atts: PostAttachment[] = comment.attachments ?? []
  return atts.filter((a) => isImageMime(a.mime_type)).map((a) => ({
    key: `c-att-${a.id}`,
    src: a.url || undefined,
    objectId: a.object_id,
    alt: a.file_name,
    status: 'ready' as const,
  }))
}

export type CommentSortBy = 'created_at' | 'like_count'
export type CommentOrder = 'asc' | 'desc'

interface Props {
  comments: Comment[]
  postId: string
  sortBy?: CommentSortBy
  order?: CommentOrder
  onSortChange?: (sortBy: CommentSortBy, order: CommentOrder) => void
}

function timeAgo(dateStr: string, t: (k: any, v?: any) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('time.justNow')
  if (mins < 60) return t('time.minutesAgoShort', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('time.hoursAgoShort', { n: hrs })
  return t('time.daysAgoShort', { n: Math.floor(hrs / 24) })
}

interface CommentNodeProps {
  comment: Comment
  postId: string
  /** When set, replies will target this comment (parent_id = replyTargetId).
   *  On top-level comments this equals comment.id. On sub-replies it equals
   *  the reply's own id so clicking "回复" starts a new leaf under it. */
  replyTargetId: string
  /** Compact layout used for sub-replies inside a top-level thread. */
  isReply?: boolean
}

function CommentNode({ comment, postId, replyTargetId, isReply = false }: CommentNodeProps) {
  const { isAuthenticated, user } = useAuth()
  const t = useT()
  const qc = useQueryClient()
  const { showConfirm } = useConfirm()
  const [showReply, setShowReply] = useState(false)
  const [replyContent, setReplyContent] = useState('')
  const [replyAttachments, setReplyAttachments] = useState<DriveNode[]>([])
  const [replyImages, setReplyImages] = useState<EditorImage[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [liked, setLiked] = useState(comment.is_liked)
  const [likeCount, setLikeCount] = useState(comment.like_count)
  const [reportOpen, setReportOpen] = useState(false)
  const replyHasUploading = replyImages.some((img) => img.status === 'uploading')

  const commentImages = commentImagesFor(comment)
  const commentNonImageAttachments =
    (comment.attachments ?? []).filter((a) => !isImageMime(a.mime_type))

  const isOwnComment = user?.id === comment.author.id
  const canDelete = isAuthenticated && (isOwnComment || user?.role === 'admin')

  const replyMut = useMutation({
    mutationFn: () => {
      const fileIds = replyAttachments
        .map((f) => f.id)
        .filter((id): id is string => Boolean(id))
      const imageIds = replyImages
        .filter((img) => img.status !== 'uploading' && img.status !== 'error')
        .map((img) => img.driveNodeId)
        .filter((id): id is string => Boolean(id))
      return addComment(postId, {
        content: replyContent,
        parent_id: replyTargetId,
        attachment_ids: [...fileIds, ...imageIds],
      })
    },
    onSuccess: () => {
      setReplyContent('')
      setReplyAttachments([])
      setReplyImages([])
      setShowReply(false)
      qc.invalidateQueries({ queryKey: ['comments', postId] })
    },
  })

  const likeMut = useMutation({
    mutationFn: () => (liked ? unlikeComment(comment.id) : likeComment(comment.id)),
    onMutate: () => {
      setLiked((v) => !v)
      setLikeCount((c) => c + (liked ? -1 : 1))
    },
    onError: () => {
      setLiked(comment.is_liked)
      setLikeCount(comment.like_count)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteComment(comment.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', postId] })
      qc.invalidateQueries({ queryKey: ['post', postId] })
    },
  })

  const openReply = () => {
    // When starting a reply on a sub-comment, prefill with the target's
    // username so the mention system picks it up and the UX is consistent
    // with the "回复 @XXX" prefix.
    if (isReply && !replyContent.trim()) {
      setReplyContent(`@${comment.author.username} `)
    }
    setShowReply((v) => !v)
  }

  const handleDelete = async () => {
    const ok = await showConfirm({ message: t('comment.confirmDelete'), danger: true })
    if (ok) deleteMut.mutate()
  }

  return (
    <div className="group">
      <div className="flex gap-2.5">
        <UserAvatar
          src={comment.author.avatar_data_url || comment.author.avatar_url}
          name={comment.author.display_name}
          size={isReply ? 'sm' : 'sm'}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/u/${comment.author.username}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-surface-on hover:text-primary"
              onClick={(e) => e.stopPropagation()}
            >
              {comment.author.display_name}
              <VipBadge user={comment.author} />
              <BannedBadge user={comment.author} />
            </Link>
            {comment.reply_to_user && (
              <>
                <span className="text-xs text-surface-on-variant">{t('comment.replyTo')}</span>
                <Link
                  to={`/u/${comment.reply_to_user.username}`}
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  @{comment.reply_to_user.display_name || comment.reply_to_user.username}
                </Link>
              </>
            )}
            <span className="text-xs text-surface-on-variant">{timeAgo(comment.created_at, t)}</span>
          </div>
          <MarkdownRenderer content={comment.content} className="text-sm text-surface-on mt-0.5" />
          {commentImages.length > 0 && (
            <div className="mt-1.5">
              <PostImageGrid images={commentImages} />
            </div>
          )}
          {commentNonImageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {commentNonImageAttachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-variant rounded text-xs text-surface-on-variant"
                >
                  <Paperclip className="h-3 w-3" aria-hidden />
                  <span className="truncate max-w-[120px]">{a.file_name}</span>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => isAuthenticated && likeMut.mutate()}
              aria-label={liked ? t('common.unlike') : t('common.like')}
              className={clsx(
                'text-xs flex items-center gap-1 transition-colors',
                liked ? 'text-error' : 'text-surface-on-variant hover:text-error',
              )}
            >
              <Heart className="h-3.5 w-3.5" fill={liked ? 'currentColor' : 'none'} aria-hidden />
              {likeCount > 0 && <span>{likeCount}</span>}
            </button>
            {isAuthenticated && (
              <button
                onClick={openReply}
                className="text-xs text-surface-on-variant hover:text-primary"
              >
                {t('comment.reply')}
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleteMut.isPending}
                aria-label={t('comment.deleteAria')}
                title={t('common.delete')}
                className="text-xs text-surface-on-variant hover:text-error inline-flex items-center gap-0.5 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                {deleteMut.isPending ? t('common.deleting') : t('common.delete')}
              </button>
            )}
            {isAuthenticated && !isOwnComment && (
              <button
                onClick={() => setReportOpen(true)}
                aria-label={t('comment.reportAria')}
                title={t('user.report')}
                className="text-xs text-surface-on-variant hover:text-error inline-flex items-center gap-0.5"
              >
                <Flag className="h-3 w-3" aria-hidden />
                {t('user.report')}
              </button>
            )}
          </div>
          {showReply && (
            <div className="mt-2">
              {replyAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {replyAttachments.map((f) => (
                    <span
                      key={f.id}
                      className="inline-flex items-center gap-1 bg-surface-variant rounded-full px-2 py-0.5 text-xs"
                    >
                      <Paperclip className="h-3 w-3" aria-hidden />
                      <span className="max-w-[120px] truncate">{f.name}</span>
                      <button
                        type="button"
                        aria-label={t('post.attachment.removeAttachment')}
                        onClick={() => setReplyAttachments((arr) => arr.filter((x) => x.id !== f.id))}
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <MarkdownEditor
                value={replyContent}
                onChange={setReplyContent}
                placeholder={isReply ? t('comment.replyToPlaceholder', { name: comment.author.display_name }) : t('comment.replyPlaceholder')}
                minHeight="64px"
                images={replyImages}
                onImagesChange={setReplyImages}
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-surface-on-variant hover:text-primary transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  {t('post.attachment.label')}
                </button>
                <button
                  onClick={() => replyMut.mutate()}
                  disabled={!replyContent.trim() || replyMut.isPending || replyHasUploading}
                  title={replyHasUploading ? t('post.imageUploadWaiting') : undefined}
                  className="px-3 py-1.5 bg-primary text-primary-on rounded text-xs font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  {replyHasUploading ? t('post.imageUploading') : t('comment.reply')}
                </button>
              </div>
              <DriveFilePicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelect={(files) => setReplyAttachments((prev) => {
                  const map = new Map(prev.map((f) => [f.id, f]))
                  for (const f of files) map.set(f.id, f)
                  return Array.from(map.values())
                })}
              />
            </div>
          )}

          {/* Sub-replies (楼中楼): render flat under the top-level comment. */}
          {!isReply && comment.replies && comment.replies.length > 0 && (
            <div className="mt-2 pl-3 border-l-2 border-outline-variant space-y-3">
              {comment.replies.map((r) => (
                <CommentNode
                  key={r.id}
                  comment={r}
                  postId={postId}
                  replyTargetId={r.id}
                  isReply
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ReportDialog
        open={reportOpen}
        targetType="comment"
        targetId={comment.id}
        targetLabel={t('post.targetLabel.comment', { name: comment.author.display_name })}
        onClose={() => setReportOpen(false)}
      />
    </div>
  )
}

export default function CommentThread({ comments, postId, sortBy, order, onSortChange }: Props) {
  const t = useT()
  const sortValue = sortBy && order ? `${sortBy}:${order}` : 'created_at:desc'
  return (
    <div className="space-y-4">
      {onSortChange && (
        <div className="flex items-center justify-end">
          <select
            value={sortValue}
            onChange={(e) => {
              const [s, o] = e.target.value.split(':') as [CommentSortBy, CommentOrder]
              onSortChange(s, o)
            }}
            className="text-xs bg-surface-variant rounded px-2 py-1.5 text-surface-on-variant focus:outline-none"
          >
            <option value="created_at:desc">{t('comment.sortNewest')}</option>
            <option value="created_at:asc">{t('comment.sortOldest')}</option>
            <option value="like_count:desc">{t('comment.sortHot')}</option>
          </select>
        </div>
      )}
      {comments.map((c) => (
        <CommentNode key={c.id} comment={c} postId={postId} replyTargetId={c.id} />
      ))}
    </div>
  )
}
