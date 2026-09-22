import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPost, getComments, addComment } from '../lib/api'
import { useAuth } from '../lib/auth'
import AppShell from '../components/layout/AppShell'
import PostCard from '../components/PostCard'
import CommentThread, { type CommentSortBy, type CommentOrder } from '../components/CommentThread'
import MarkdownEditor, { type EditorImage } from '../components/MarkdownEditor'
import DriveFilePicker from '../components/DriveFilePicker'
import type { DriveNode } from '../types'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { FileText, MessageCircle, Paperclip, X } from '../components/icons'
import { useT } from '../lib/i18n'

export default function PostDetailPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const postId = id!
  const { isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const [commentText, setCommentText] = useState('')
  const [commentAttachments, setCommentAttachments] = useState<DriveNode[]>([])
  const [commentImages, setCommentImages] = useState<EditorImage[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sortBy, setSortBy] = useState<CommentSortBy>('created_at')
  const [order, setOrder] = useState<CommentOrder>('desc')
  const commentHasUploading = commentImages.some((img) => img.status === 'uploading')

  const { data: post, isLoading: postLoading } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => getPost(postId),
    enabled: !!id,
  })

  const { data: commentsData, isLoading: commentsLoading } = useQuery({
    queryKey: ['comments', postId, sortBy, order],
    queryFn: () => getComments(postId, undefined, sortBy, order),
    enabled: !!id,
  })

  const commentMut = useMutation({
    mutationFn: () => {
      const fileIds = commentAttachments
        .map((f) => f.id)
        .filter((id): id is string => Boolean(id))
      const imageIds = commentImages
        .filter((img) => img.status !== 'uploading' && img.status !== 'error')
        .map((img) => img.driveNodeId)
        .filter((id): id is string => Boolean(id))
      return addComment(postId, {
        content: commentText,
        attachment_ids: [...fileIds, ...imageIds],
      })
    },
    onSuccess: () => {
      setCommentText('')
      setCommentAttachments([])
      setCommentImages([])
      qc.invalidateQueries({ queryKey: ['comments', postId] })
      qc.invalidateQueries({ queryKey: ['post', postId] })
    },
  })

  if (postLoading) {
    return <AppShell><LoadingSpinner className="py-20" /></AppShell>
  }

  if (!post) {
    return <AppShell><EmptyState icon={<FileText className="h-14 w-14" />} title={t('post.notFound')} /></AppShell>
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <PostCard post={post} showFull />

        {/* Comment input */}
        {isAuthenticated && (
          <div className="mt-4 bg-surface rounded shadow-elevation-1 p-4">
            {commentAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {commentAttachments.map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 bg-surface-variant rounded-full px-2 py-0.5 text-xs">
                    <Paperclip className="h-3 w-3" aria-hidden />
                    <span className="max-w-[140px] truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={t('post.attachment.removeAttachment')}
                      onClick={() => setCommentAttachments((arr) => arr.filter((x) => x.id !== f.id))}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <MarkdownEditor
              value={commentText}
              onChange={setCommentText}
              placeholder={t('comment.placeholder')}
              minHeight="96px"
              images={commentImages}
              onImagesChange={setCommentImages}
            />
            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-surface-on-variant hover:text-primary transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" aria-hidden />
                {t('post.attachment.label')}
              </button>
              <button
                onClick={() => commentMut.mutate()}
                disabled={!commentText.trim() || commentMut.isPending || commentHasUploading}
                title={commentHasUploading ? t('post.imageUploadWaiting') : undefined}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {commentMut.isPending
                  ? t('comment.sending')
                  : commentHasUploading
                    ? t('post.imageUploading')
                    : t('comment.send')}
              </button>
            </div>
            {commentMut.isError && (
              <p className="text-xs text-error mt-1">{(commentMut.error as Error).message}</p>
            )}
          </div>
        )}

        {/* Comments */}
        <div className="mt-6">
          <h2 className="text-sm font-medium text-surface-on-variant mb-4">
            {t('comment.titleWithCount', { count: post.comment_count })}
          </h2>
          {commentsLoading ? (
            <LoadingSpinner className="py-8" />
          ) : !commentsData || commentsData.items.length === 0 ? (
            <EmptyState icon={<MessageCircle className="h-14 w-14" />} title={t('comment.empty')} description={t('comment.emptyDesc')} />
          ) : (
            <CommentThread
              comments={commentsData.items}
              postId={postId}
              sortBy={sortBy}
              order={order}
              onSortChange={(s, o) => { setSortBy(s); setOrder(o) }}
            />
          )}
        </div>
      </div>
      <DriveFilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(files) => setCommentAttachments((prev) => {
          const map = new Map(prev.map((f) => [f.id, f]))
          for (const f of files) map.set(f.id, f)
          return Array.from(map.values())
        })}
      />
    </AppShell>
  )
}
