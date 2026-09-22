import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { getPreviewUrl } from '../lib/api'
import { useT } from '../lib/i18n'
import ImageLightbox, { type LightboxImage } from './ImageLightbox'
import { X, Image as ImageIcon, AlertTriangle, Trash2 } from './icons'

// Source describes one image cell in the grid.
//
//   - `src`        — direct URL to display (blob URL during upload, or a
//                    pre-fetched URL). Takes precedence over `objectId`.
//   - `objectId`   — when set (and `src` is empty) the grid lazily fetches
//                    `/api/files/{objectId}/preview` via `fetchPreviewBlobUrl`
//                    and shows the resulting blob.
//
// Editor cells additionally carry upload progress / error state via
// `status` so we can render a progress overlay or retry message.
export interface PostImageSource {
  key: string
  src?: string
  objectId?: string
  alt?: string
  status?: 'uploading' | 'ready' | 'error' | 'deleted'
  progress?: number
  errorMessage?: string
}

interface Props {
  images: PostImageSource[]
  // When provided, each cell shows a remove (✕) button in editor mode.
  onRemove?: (index: number) => void
  // Maximum cells before the trailing "+N" overflow tile kicks in.
  maxVisible?: number
  className?: string
}

const DEFAULT_MAX_VISIBLE = 9

// Map total visible count → tailwind grid template. Single image gets a
// dedicated wide layout, 2/4 use 2 columns, everything else uses 3.
function gridClassFor(count: number): string {
  if (count <= 1) return 'grid-cols-1 max-w-[280px]'
  if (count === 2 || count === 4) return 'grid-cols-2 max-w-[440px]'
  return 'grid-cols-3 max-w-[520px]'
}

function resolveImageSrc(image: PostImageSource): string {
  const previewSrc = image.objectId ? getPreviewUrl(image.objectId) : ''
  if (image.objectId && image.src?.startsWith('blob:') && image.status !== 'uploading') {
    return previewSrc || image.src
  }
  return image.src || previewSrc
}

export default function PostImageGrid({
  images,
  onRemove,
  maxVisible = DEFAULT_MAX_VISIBLE,
  className,
}: Props) {
  const t = useT()
  const total = images.length
  // When the total exceeds the cap we reserve the last cell for the "+N"
  // overflow tile, so we slice to (max - 1) and append the overflow marker.
  const overflow = total > maxVisible
  const visibleCount = overflow ? maxVisible - 1 : total
  const visible = images.slice(0, visibleCount)
  const overflowCount = total - visibleCount

  const [lightboxIndex, setLightboxIndex] = useState(-1)

  // Compute the effective display URL for each image: explicit src (e.g. local
  // blob during upload) wins; otherwise build a token-bearing preview URL from
  // objectId. This mirrors what PostImageCell does so lightbox URLs match.
  const effectiveSrcs = images.map(resolveImageSrc)

  // Build the lightbox image list, skipping uploads/errors.
  const lightboxImages: LightboxImage[] = images
    .map((img, i) => ({ src: effectiveSrcs[i], alt: img.alt, status: img.status }))
    .filter((img) => Boolean(img.src) && img.status !== 'uploading' && img.status !== 'error')
    .map((img) => ({ src: img.src!, alt: img.alt }))

  if (total === 0) return null

  const handleCellClick = (index: number) => {
    const img = images[index]
    if (!img || img.status === 'uploading' || img.status === 'error') return
    const src = effectiveSrcs[index]
    if (!src) return
    const lbIndex = lightboxImages.findIndex((l) => l.src === src)
    if (lbIndex >= 0) setLightboxIndex(lbIndex)
  }

  return (
    <>
      <div
        className={clsx(
          'grid gap-1.5',
          gridClassFor(visible.length + (overflow ? 1 : 0)),
          className,
        )}
      >
        {visible.map((img, idx) => (
          <PostImageCell
            key={img.key}
            image={img}
            single={visible.length === 1 && !overflow}
            onClick={() => handleCellClick(idx)}
            onRemove={onRemove ? () => onRemove(idx) : undefined}
          />
        ))}
        {overflow && (
          <button
            type="button"
            onClick={() => {
              // Open the lightbox at the first image hidden by the overflow.
              const firstHiddenSrc = effectiveSrcs[visibleCount]
              if (firstHiddenSrc) {
                const lbIndex = lightboxImages.findIndex((l) => l.src === firstHiddenSrc)
                if (lbIndex >= 0) setLightboxIndex(lbIndex)
              }
            }}
            className="relative aspect-square overflow-hidden rounded border border-outline-variant bg-surface-variant text-surface-on-variant transition-colors hover:bg-surface-variant/80"
            aria-label={t('lightbox.overflowMore', { n: overflowCount })}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <span className="text-2xl font-light">+{overflowCount}</span>
              <span className="text-xs">{t('lightbox.viewMore')}</span>
            </div>
          </button>
        )}
      </div>

      <ImageLightbox
        images={lightboxImages}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(-1)}
        onIndexChange={setLightboxIndex}
      />
    </>
  )
}

// ────────────────────────────────────────────────────────────
// Single cell — handles lazy fetching of authenticated previews via
// IntersectionObserver, plus the placeholder/loading/error states.
// ────────────────────────────────────────────────────────────

interface CellProps {
  image: PostImageSource
  single: boolean
  onClick?: () => void
  onRemove?: () => void
}

function PostImageCell({ image, single, onClick, onRemove }: CellProps) {
  const t = useT()
  // Once an upload has an object id, prefer the stable preview endpoint over
  // any leftover blob URL so the image survives unmounts, revokes and reloads.
  const resolvedSrc = resolveImageSrc(image)

  const [imgLoaded, setImgLoaded] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  // Reset load/error state when the src changes.
  const prevSrcRef = useRef(resolvedSrc)
  useEffect(() => {
    if (prevSrcRef.current !== resolvedSrc) {
      prevSrcRef.current = resolvedSrc
      setImgLoaded(false)
      setFetchError(false)
    }
  }, [resolvedSrc])

  const isUploading = image.status === 'uploading'
  const isDeleted = image.status === 'deleted'
  const isError = image.status === 'error' || fetchError
  const showPlaceholder = !resolvedSrc || !imgLoaded
  const interactive = !isUploading && !isError && !isDeleted && Boolean(resolvedSrc)

  return (
    <div
      className={clsx(
        'group relative overflow-hidden rounded border border-outline-variant bg-surface-variant',
        // Single-image layout: don't force square; let it grow naturally up
        // to a sensible cap so portraits and landscapes both look right.
        single ? 'max-h-80 min-h-40' : 'aspect-square',
      )}
    >
      {/* Skeleton/placeholder shown while idle, loading or before <img>
          paints. Suppressed during uploads — the upload overlay below
          already provides clear feedback and the blob preview lights up
          almost immediately. */}
      {showPlaceholder && !isError && !isUploading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-variant">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-surface-variant via-surface-variant/60 to-surface-variant" />
          <ImageIcon className="relative h-6 w-6 text-surface-on-variant/40" aria-hidden />
          <span className="relative text-[10px] text-surface-on-variant/60">
            {t('common.loading')}
          </span>
        </div>
      )}

      {/* Actual image — only mounted once we have a src */}
      {resolvedSrc && !isError && (
        <img
          src={resolvedSrc}
          alt={image.alt || ''}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={() => setFetchError(true)}
          onClick={(e) => {
            if (!interactive) return
            e.stopPropagation()
            onClick?.()
          }}
          className={clsx(
            'h-full w-full transition-opacity duration-200',
            single ? 'object-contain' : 'object-cover',
            imgLoaded ? 'opacity-100' : 'opacity-0',
            interactive && 'cursor-zoom-in',
          )}
        />
      )}

      {/* Upload progress overlay — covers the entire cell while the file is
          in flight. Renders a circular progress ring + percentage on top of
          a translucent dim layer so the user always sees the image they
          picked plus a clear indication that the upload is still running. */}
      {isUploading && (
        <UploadProgressOverlay progress={image.progress ?? 0} />
      )}

      {/* Error overlay */}
      {isError && !isDeleted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-surface-variant text-error">
          <AlertTriangle className="h-6 w-6" aria-hidden />
          <span className="px-2 text-center text-[10px]">
            {image.errorMessage || t('common.loadFailed')}
          </span>
        </div>
      )}

      {/* Deleted overlay — file removed by owner or admin */}
      {isDeleted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-surface-variant text-surface-on-variant/70">
          <Trash2 className="h-6 w-6" aria-hidden />
          <span className="px-2 text-center text-[10px]">
            {t('post.attachment.deleted')}
          </span>
        </div>
      )}

      {/* Remove button (editor mode) — appears top-right on hover */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={t('post.attachment.removeImage')}
          className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/75"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Upload progress overlay — translucent dim layer + circular ring + label.
// Layered above the image so the user keeps visual context of what's
// being uploaded while still seeing live progress.
// ────────────────────────────────────────────────────────────

interface OverlayProps {
  progress: number // 0..1
}

function UploadProgressOverlay({ progress }: OverlayProps) {
  const t = useT()
  const clamped = Math.max(0, Math.min(1, progress))
  const percent = Math.round(clamped * 100)
  // SVG ring geometry: circumference = 2πr. We pick r=16 inside a
  // 40×40 viewBox so the stroke + padding fit comfortably.
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped)

  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/45 backdrop-blur-[1px]"
      aria-live="polite"
      aria-label={t('post.imageProgress', { percent })}
    >
      <svg
        viewBox="0 0 40 40"
        className="h-12 w-12 -rotate-90"
        aria-hidden
      >
        {/* Track */}
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="3"
        />
        {/* Progress */}
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 150ms linear' }}
        />
      </svg>
      <span className="text-xs font-medium tabular-nums text-white drop-shadow">
        {percent}%
      </span>
      <span className="text-[10px] text-white/80">{t('common.uploading')}</span>
    </div>
  )
}
