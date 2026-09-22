import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createPost, getSearchSuggest, updatePost } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import type { DriveNode, Post, Topic } from '../types'
import UserAvatar from './UserAvatar'
import MarkdownEditor, { type EditorImage } from './MarkdownEditor'
import DriveFilePicker from './DriveFilePicker'
import { Paperclip, X, Globe, Users, Lock, Flame } from './icons'

// Mime types we treat as inline images (rendered in the 9-grid). Anything
// else stays on the regular attachment chip list.
function isImageMime(mime?: string): boolean {
  return Boolean(mime && mime.toLowerCase().startsWith('image/'))
}

interface Props {
  // When provided, the composer is in "edit" mode and updates this post
  // instead of creating a new one.
  editingPost?: Post
  onCancel?: () => void
  onSuccess?: () => void
}

// Build a minimal DriveNode-shaped object from a post attachment so we can
// reuse the existing chip rendering. Only the fields the composer reads (id,
// name, mime_type, object_id) need to be meaningful.
function attachmentToDriveNodeStub(att: Post['attachments'][number]): DriveNode | null {
  if (!att.drive_node_id) return null
  return {
    id: att.drive_node_id,
    parent_id: null,
    name: att.file_name,
    is_folder: false,
    object_id: att.object_id,
    size: att.file_size,
    mime_type: att.mime_type,
    children: [],
    is_trashed: false,
    trashed_at: null,
    created_at: '',
    updated_at: '',
  }
}

// Convert an image attachment from a saved post into the EditorImage shape
// the markdown editor's grid expects. Prefers the backend-resolved CDN URL
// (attachment.url) when present, falling back to objectId so the grid will
// lazy-fetch via the authenticated preview endpoint.
function attachmentToEditorImage(att: Post['attachments'][number]): EditorImage {
  return {
    key: `att-${att.id}`,
    src: att.url || undefined,
    objectId: att.object_id,
    driveNodeId: att.drive_node_id ?? undefined,
    fileName: att.file_name,
    alt: att.file_name,
    status: 'ready',
  }
}

export default function PostComposer({ editingPost, onCancel, onSuccess }: Props = {}) {
  const { user } = useAuth()
  const t = useT()
  const qc = useQueryClient()
  const isEdit = Boolean(editingPost)
  const [content, setContent] = useState(editingPost?.content ?? '')
  const [visibility, setVisibility] = useState<'public' | 'followers' | 'private'>(
    editingPost?.visibility ?? 'public',
  )
  const [expanded, setExpanded] = useState(isEdit)
  // Non-image attachments (selected via the drive picker). Image attachments
  // from the original post are routed into `images` instead so they show up
  // inside the editor's 9-grid.
  const [attachments, setAttachments] = useState<DriveNode[]>(() =>
    (editingPost?.attachments ?? [])
      .filter((a) => !isImageMime(a.mime_type))
      .map(attachmentToDriveNodeStub)
      .filter((n): n is DriveNode => n !== null),
  )
  const [images, setImages] = useState<EditorImage[]>(() =>
    (editingPost?.attachments ?? [])
      .filter((a) => isImageMime(a.mime_type))
      .map(attachmentToEditorImage),
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [topicPickerOpen, setTopicPickerOpen] = useState(false)

  // True while at least one image is still uploading; we block submission
  // until everything has either succeeded or failed (failed entries are
  // simply ignored when assembling attachment_ids).
  const hasUploadingImage = images.some((img) => img.status === 'uploading')

  const insertTopic = (topic: Topic) => {
    const tag = `#${topic.name}#`
    setContent((prev) => {
      if (!prev) return tag
      // Avoid duplicate consecutive insertions.
      if (prev.includes(tag)) return prev
      const sep = prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' '
      return prev + sep + tag + ' '
    })
    setTopicPickerOpen(false)
  }

  const mutation = useMutation({
    mutationFn: () => {
      // Combine non-image attachments with successfully uploaded images.
      // Images appear *after* file attachments so the backend stores them
      // with higher sort_order — display order is preserved on read.
      const fileIds = attachments.map((f) => f.id).filter((id): id is string => Boolean(id))
      const imageIds = images
        .filter((img) => img.status !== 'uploading' && img.status !== 'error')
        .map((img) => img.driveNodeId)
        .filter((id): id is string => Boolean(id))
      const ids = [...fileIds, ...imageIds]
      if (isEdit && editingPost) {
        return updatePost(editingPost.id, { content, visibility, attachment_ids: ids })
      }
      return createPost({ content, visibility, attachment_ids: ids })
    },
    onSuccess: () => {
      if (isEdit && editingPost) {
        qc.invalidateQueries({ queryKey: ['post', editingPost.id] })
        qc.invalidateQueries({ queryKey: ['feed'] })
        qc.invalidateQueries({ queryKey: ['publicFeed'] })
        qc.invalidateQueries({ queryKey: ['trending'] })
        qc.invalidateQueries({ queryKey: ['userProfile'] })
        onSuccess?.()
        return
      }
      setContent('')
      setAttachments([])
      setImages([])
      setExpanded(false)
      qc.invalidateQueries({ queryKey: ['feed'] })
      qc.invalidateQueries({ queryKey: ['publicFeed'] })
      qc.invalidateQueries({ queryKey: ['trending'] })
      qc.invalidateQueries({ queryKey: ['userProfile'] })
    },
  })

  const handleCancel = () => {
    if (mutation.isPending) return
    if (isEdit) {
      onCancel?.()
      return
    }
    setExpanded(false)
    setContent('')
    setAttachments([])
    setImages([])
  }

  if (!user) return null

  // Edit mode renders without the avatar / collapse animation, plain panel.
  const wrapperClass = isEdit
    ? 'bg-surface-variant/30 rounded p-3'
    : 'bg-surface rounded shadow-elevation-1 p-4 mb-4'

  return (
    <div className={wrapperClass}>
      <div className={isEdit ? 'flex-1' : 'flex gap-3'}>
        {!isEdit && <UserAvatar src={user.avatar_url} name={user.display_name} size="md" />}
        <div className="flex-1">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1.5 bg-surface-variant rounded-full px-3 py-1 text-xs text-surface-on-variant"
                >
                  <Paperclip className="h-3 w-3" aria-hidden />
                  <span className="max-w-[140px] truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={t('post.attachment.removeAttachment')}
                    onClick={() => setAttachments((arr) => arr.filter((x) => x.id !== f.id))}
                    className="hover:text-error"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          {expanded ? (
            <MarkdownEditor
              value={content}
              onChange={setContent}
              placeholder={t('post.publishPlaceholder')}
              minHeight="120px"
              images={images}
              onImagesChange={setImages}
            />
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onFocus={() => setExpanded(true)}
              placeholder={t('post.publishPlaceholder')}
              className="w-full resize-none bg-surface-variant/60 rounded px-4 py-3 text-sm text-surface-on placeholder:text-surface-on-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[48px]"
              rows={1}
            />
          )}
          {expanded && (
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1.5 bg-surface-variant rounded px-2 py-1.5 text-xs text-surface-on-variant">
                  {visibility === 'public' && <Globe className="h-3.5 w-3.5" aria-hidden />}
                  {visibility === 'followers' && <Users className="h-3.5 w-3.5" aria-hidden />}
                  {visibility === 'private' && <Lock className="h-3.5 w-3.5" aria-hidden />}
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as 'public' | 'followers' | 'private')}
                    className="bg-transparent text-surface-on-variant focus:outline-none"
                  >
                    <option value="public">{t('post.publicSelect')}</option>
                    <option value="followers">{t('post.followersSelect')}</option>
                    <option value="private">{t('post.privateSelect')}</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1 text-xs bg-surface-variant rounded px-2 py-1.5 text-surface-on-variant hover:bg-surface-variant/70 transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  {t('post.attachment.label')}
                </button>
                <button
                  type="button"
                  onClick={() => setTopicPickerOpen(true)}
                  title={t('post.insertTopic')}
                  className="inline-flex items-center gap-1 text-xs bg-surface-variant rounded px-2 py-1.5 text-surface-on-variant hover:bg-surface-variant/70 transition-colors"
                >
                  <Flame className="h-3.5 w-3.5 text-error" aria-hidden />
                  {t('post.topic')}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => mutation.mutate()}
                  disabled={!content.trim() || mutation.isPending || hasUploadingImage}
                  title={hasUploadingImage ? t('post.imageUploadWaiting') : undefined}
                  className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  {mutation.isPending
                    ? (isEdit ? t('post.saving') : t('post.publishing'))
                    : hasUploadingImage
                      ? t('post.imageUploading')
                      : (isEdit ? t('post.savePost') : t('post.publishPost'))}
                </button>
              </div>
            </div>
          )}
          {mutation.isError && (
            <p className="text-xs text-error mt-2">{(mutation.error as Error).message}</p>
          )}
        </div>
      </div>
      <DriveFilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(files) => setAttachments((prev) => {
          const map = new Map(prev.map((f) => [f.id, f]))
          for (const f of files) map.set(f.id, f)
          return Array.from(map.values())
        })}
      />
      {topicPickerOpen && (
        <TopicPickerDialog
          onClose={() => setTopicPickerOpen(false)}
          onPick={insertTopic}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Topic picker dialog — small, focused on inserting a #tag# token.
// ────────────────────────────────────────────────────────────

function TopicPickerDialog({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (topic: Topic) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const { data, isLoading } = useQuery({
    queryKey: ['topicPicker', debounced],
    queryFn: () => getSearchSuggest(debounced),
    staleTime: 30000,
  })

  const topics = data?.topics ?? []

  const submitCustom = () => {
    const trimmed = query.trim().replace(/^#+|#+$/g, '')
    if (!trimmed) return
    onPick({
      id: '',
      name: trimmed,
      slug: trimmed.toLowerCase(),
      description: '',
      post_count: 0,
      follower_count: 0,
      cover_url: '',
      created_at: '',
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-surface text-surface-on rounded shadow-elevation-16 w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-divider">
          <h3 className="text-base font-medium mb-2">{t('topic.insertTitle')}</h3>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (topics.length > 0) onPick(topics[0])
                else submitCustom()
              }
              if (e.key === 'Escape') onClose()
            }}
            placeholder={t('topic.searchPlaceholder')}
            className="w-full bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
          />
        </div>
        <div className="max-h-64 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <p className="px-4 py-6 text-center text-sm text-surface-on-variant">{t('common.loadingDots')}</p>
          ) : topics.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-surface-on-variant">
              {query.trim() ? (
                <>
                  {t('topic.noMatch')}
                  <br />
                  <button
                    type="button"
                    onClick={submitCustom}
                    className="mt-2 text-primary hover:underline"
                  >
                    {t('topic.createNew', { name: query.trim().replace(/^#+|#+$/g, '') })}
                  </button>
                </>
              ) : (
                t('topic.searchExisting')
              )}
            </div>
          ) : (
            topics.map((topic) => (
              <button
                key={topic.id || topic.slug}
                type="button"
                onClick={() => onPick(topic)}
                className="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-surface-variant"
              >
                <span className="text-primary truncate">#{topic.name}</span>
                <span className="text-xs text-surface-on-variant tabular-nums shrink-0">
                  {topic.post_count} {t('topic.postSuffix')}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-divider">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
