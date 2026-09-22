import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import MarkdownRenderer from './MarkdownRenderer'
import PostImageGrid, { type PostImageSource } from './PostImageGrid'
import UserAvatar from './UserAvatar'
import BannedBadge from './BannedBadge'
import { mentionSearch, uploadFileXHR } from '../lib/api'
import { AtSign, LinkIcon, Image as ImageIcon, Eye } from './icons'
import { useT } from '../lib/i18n'

// EditorImage extends PostImageSource with the bookkeeping fields the editor
// needs (a stable temporary id during upload, and the resolved drive node id
// the parent uses when assembling `attachment_ids` for create/update calls).
export interface EditorImage extends PostImageSource {
  driveNodeId?: string
  fileName?: string
}

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
  className?: string
  // When provided, the toolbar exposes an inline image upload button and the
  // editor renders a 9-grid of uploaded images below the textarea/preview.
  // Omit these to opt out (e.g. legacy callers that don't yet manage images).
  images?: EditorImage[]
  onImagesChange?: (next: EditorImage[]) => void
  maxImages?: number
}

type Action =
  | { type: 'wrap'; before: string; after: string; placeholder?: string }
  | { type: 'linePrefix'; prefix: string }
  | { type: 'insert'; text: string }

const DEFAULT_MAX_IMAGES = 9
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml'

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minHeight = '120px',
  className,
  images,
  onImagesChange,
  maxImages = DEFAULT_MAX_IMAGES,
}: MarkdownEditorProps) {
  const t = useT()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewing, setPreviewing] = useState(false)
  const resolvedPlaceholder = placeholder ?? t('editor.defaultPlaceholder')

  // ── @mention ──────────────────────────────────────────────────
  // mentionQuery: null = inactive, string = query typed after @
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionTriggerStart, setMentionTriggerStart] = useState(0)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: mentionUsers = [] } = useQuery({
    queryKey: ['mentionSearch', mentionQuery],
    queryFn: () => mentionSearch(mentionQuery!),
    enabled: mentionQuery !== null,
    staleTime: 30_000,
  })

  // Reposition the dropdown whenever it becomes active
  useEffect(() => {
    if (mentionQuery !== null && textareaRef.current) {
      setDropdownRect(textareaRef.current.getBoundingClientRect())
    }
  }, [mentionQuery])

  // Close when clicking outside the dropdown
  useEffect(() => {
    if (mentionQuery === null) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setMentionQuery(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [mentionQuery])

  const insertMention = useCallback((username: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const newValue =
      value.slice(0, mentionTriggerStart) +
      '@' + username + ' ' +
      value.slice(cursor)
    onChange(newValue)
    setMentionQuery(null)
    const newPos = mentionTriggerStart + username.length + 2
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    })
  }, [value, onChange, mentionTriggerStart])

  const openMentionAt = useCallback((triggerIdx: number, initialQuery = '') => {
    setMentionTriggerStart(triggerIdx)
    setMentionQuery(initialQuery)
    setMentionIdx(0)
  }, [])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    onChange(newVal)
    const cursor = e.target.selectionStart
    const before = newVal.slice(0, cursor)
    // Look for @ immediately before cursor (allow partial username or just @)
    const match = /@([a-z][a-z0-9_]*)?$/.exec(before)
    if (match) {
      setMentionTriggerStart(match.index)
      setMentionQuery(match[1]?.toLowerCase() ?? '')
      setMentionIdx(0)
    } else {
      setMentionQuery(null)
    }
  }, [onChange])

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery === null || mentionUsers.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIdx(i => Math.min(i + 1, mentionUsers.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      insertMention(mentionUsers[mentionIdx].username)
    } else if (e.key === 'Escape') {
      setMentionQuery(null)
    }
  }, [mentionQuery, mentionUsers, mentionIdx, insertMention])

  // Whether image upload UI is enabled. Both props must be supplied — we use
  // `images` for the current list and `onImagesChange` for updates.
  const imagesEnabled = Boolean(images && onImagesChange)
  const currentImages = images ?? []

  // The editor uses blob: URLs as immediate previews while the upload is
  // in flight. Track them so we can revoke on unmount and avoid leaks.
  const blobUrlsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      blobUrlsRef.current.clear()
    }
  }, [])

  const apply = (action: Action) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    let next = value
    let newStart = start
    let newEnd = end
    if (action.type === 'wrap') {
      const inner = selected || action.placeholder || ''
      const insert = action.before + inner + action.after
      next = value.slice(0, start) + insert + value.slice(end)
      newStart = start + action.before.length
      newEnd = newStart + inner.length
    } else if (action.type === 'linePrefix') {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      next = value.slice(0, lineStart) + action.prefix + value.slice(lineStart)
      newStart = start + action.prefix.length
      newEnd = end + action.prefix.length
    } else {
      next = value.slice(0, start) + action.text + value.slice(end)
      newStart = start + action.text.length
      newEnd = newStart
    }
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(newStart, newEnd)
    })
  }

  // ────────────────────────────────────────────────────────────
  // Image upload handling
  // ────────────────────────────────────────────────────────────

  // Patch a single image entry by its stable key. Always reads the latest
  // list from the parent via the most recent `images` prop snapshot to avoid
  // stale-state races during concurrent uploads.
  const patchImage = (key: string, patch: Partial<EditorImage>) => {
    if (!onImagesChange) return
    const latest = imagesRef.current
    onImagesChange(
      latest.map((img) => (img.key === key ? { ...img, ...patch } : img)),
    )
  }

  // Keep a ref to the latest images so async upload callbacks can read it
  // without going stale (the closure captures the prop value at call time).
  const imagesRef = useRef<EditorImage[]>(currentImages)
  useEffect(() => {
    imagesRef.current = currentImages
  })

  const releaseBlobUrl = (url?: string) => {
    if (!url || !blobUrlsRef.current.has(url)) return
    blobUrlsRef.current.delete(url)
    URL.revokeObjectURL(url)
  }

  const handlePickImages = () => {
    if (!imagesEnabled) return
    fileInputRef.current?.click()
  }

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || !onImagesChange) return
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    // Reset the input so the same file can be re-selected next time.
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (files.length === 0) return

    const remainingSlots = maxImages - imagesRef.current.length
    if (remainingSlots <= 0) return
    const accepted = files.slice(0, remainingSlots)

    // Build placeholder entries with blob URL previews and append in one
    // batch so the UI immediately reflects the new uploads.
    const placeholders: EditorImage[] = accepted.map((file) => {
      const blobUrl = URL.createObjectURL(file)
      blobUrlsRef.current.add(blobUrl)
      return {
        key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        src: blobUrl,
        alt: file.name,
        fileName: file.name,
        status: 'uploading',
        progress: 0,
      }
    })
    onImagesChange([...imagesRef.current, ...placeholders])

    // Kick off uploads in parallel. Each one independently patches its own
    // entry on progress / completion / error. The "post_image" purpose
    // routes uploads into the per-user system folder and skips quota.
    accepted.forEach((file, idx) => {
      const placeholder = placeholders[idx]
      uploadFileXHR(null, file, {
        purpose: 'post_image',
        onProgress: (e) => {
          patchImage(placeholder.key, { progress: e.percent })
        },
      })
        .then(({ node }) => {
          const blobUrl = placeholder.src
          patchImage(placeholder.key, {
            status: 'ready',
            progress: 1,
            driveNodeId: node.id,
            objectId: node.object_id ?? undefined,
            src: undefined,
            // Blob URLs are only valid in the current document. Render ready
            // images through the stable preview endpoint instead.
          })
          requestAnimationFrame(() => releaseBlobUrl(blobUrl))
        })
        .catch((err: Error) => {
          patchImage(placeholder.key, {
            status: 'error',
            errorMessage: err?.message || t('common.uploadFailed'),
          })
        })
    })
  }

  const handleRemoveImage = (index: number) => {
    if (!onImagesChange) return
    const target = imagesRef.current[index]
    if (!target) return
    releaseBlobUrl(target.src)
    onImagesChange(imagesRef.current.filter((_, i) => i !== index))
  }

  const reachedLimit = currentImages.length >= maxImages

  // ────────────────────────────────────────────────────────────
  // Toolbar
  // ────────────────────────────────────────────────────────────

  const buttons: { label: ReactNode; title: string; run: () => void; disabled?: boolean }[] = [
    { label: <span className="font-bold">B</span>, title: t('editor.bold'), run: () => apply({ type: 'wrap', before: '**', after: '**', placeholder: t('editor.boldText') }) },
    { label: <span className="italic">I</span>, title: t('editor.italic'), run: () => apply({ type: 'wrap', before: '*', after: '*', placeholder: t('editor.italicText') }) },
    { label: <span className="font-bold">H</span>, title: t('editor.heading'), run: () => apply({ type: 'linePrefix', prefix: '## ' }) },
    { label: '>', title: t('editor.quote'), run: () => apply({ type: 'linePrefix', prefix: '> ' }) },
    { label: <span className="font-mono">`</span>, title: t('editor.code'), run: () => apply({ type: 'wrap', before: '`', after: '`', placeholder: 'code' }) },
    { label: <LinkIcon className="h-3.5 w-3.5" />, title: t('editor.link'), run: () => apply({ type: 'wrap', before: '[', after: '](https://)', placeholder: t('editor.linkText') }) },
    { label: '•', title: t('editor.list'), run: () => apply({ type: 'linePrefix', prefix: '- ' }) },
    {
      label: <AtSign className="h-3.5 w-3.5" />,
      title: t('mention.insertUser'),
      run: () => {
        const ta = textareaRef.current
        if (!ta) return
        const start = ta.selectionStart
        const newVal = value.slice(0, start) + '@' + value.slice(start)
        onChange(newVal)
        openMentionAt(start, '')
        requestAnimationFrame(() => {
          ta.focus()
          ta.setSelectionRange(start + 1, start + 1)
        })
      },
    },
  ]

  // The image upload button is only shown when image management is wired up.
  if (imagesEnabled) {
    buttons.push({
      label: <ImageIcon className="h-3.5 w-3.5" />,
      title: reachedLimit ? t('editor.maxImages', { n: maxImages }) : t('editor.uploadImage'),
      run: handlePickImages,
      disabled: reachedLimit,
    })
  }

  return (
    <div className={clsx('rounded border border-outline focus-within:border-primary focus-within:border-2 bg-surface overflow-hidden', className)}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-divider bg-surface-variant/40">
        {buttons.map((b) => (
          <button
            key={b.title}
            type="button"
            title={b.title}
            onClick={b.run}
            disabled={b.disabled}
            className="h-7 min-w-[28px] px-1.5 rounded text-xs font-medium text-surface-on-variant hover:bg-surface-variant inline-flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          title={t('editor.preview')}
          aria-label={t('editor.preview')}
          onClick={() => setPreviewing((v) => !v)}
          className={clsx(
            'h-7 min-w-[28px] px-1.5 rounded text-xs ml-auto inline-flex items-center justify-center transition-colors',
            previewing ? 'bg-primary/15 text-primary' : 'text-surface-on-variant hover:bg-surface-variant',
          )}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {previewing ? (
        <div className="px-4 py-3 text-sm text-surface-on" style={{ minHeight }}>
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <span className="text-surface-on-variant/60">{t('editor.emptyPreview')}</span>
          )}
          {imagesEnabled && currentImages.length > 0 && (
            <div className="mt-3">
              <PostImageGrid images={currentImages} maxVisible={maxImages} />
            </div>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextareaChange}
          onKeyDown={handleTextareaKeyDown}
          placeholder={resolvedPlaceholder}
          style={{ minHeight }}
          className="w-full resize-y bg-transparent px-4 py-3 text-sm text-surface-on placeholder:text-surface-on-variant/50 focus:outline-none"
        />
      )}

      {imagesEnabled && currentImages.length > 0 && !previewing && (
        <div className="border-t border-divider bg-surface-variant/20 px-4 py-3">
          <PostImageGrid
            images={currentImages}
            onRemove={handleRemoveImage}
            maxVisible={maxImages}
          />
          <p className="mt-2 text-[11px] text-surface-on-variant/70">
            {t('editor.imageCountInfo', { current: currentImages.length, max: maxImages })}
          </p>
        </div>
      )}

      {imagesEnabled && (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          hidden
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
      )}

      {/* @mention dropdown — rendered via portal so it's not clipped */}
      {mentionQuery !== null && dropdownRect && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownRect.bottom + 4,
            left: dropdownRect.left,
            width: Math.min(dropdownRect.width, 300),
            zIndex: 9999,
          }}
          className="bg-surface rounded-xl shadow-elevation-8 border border-outline-variant overflow-hidden"
        >
          {mentionUsers.length === 0 ? (
            <p className="px-4 py-3 text-sm text-surface-on-variant">
              {mentionQuery === '' ? t('mention.placeholder') : t('mention.notFound')}
            </p>
          ) : (
            <ul>
              {mentionUsers.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault() // prevent textarea blur
                      insertMention(u.username)
                    }}
                    className={clsx(
                      'flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors',
                      i === mentionIdx
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-surface-variant',
                    )}
                  >
                    <UserAvatar src={u.avatar_url} name={u.display_name} size="sm" />
                    <span className="inline-flex items-center gap-1 font-medium truncate">
                      {u.display_name}
                      <BannedBadge user={u} />
                    </span>
                    <span className="text-surface-on-variant text-xs truncate">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
