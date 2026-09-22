import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight } from './icons'
import { useT } from '../lib/i18n'

export interface LightboxImage {
  src: string
  alt?: string
}

interface Props {
  images: LightboxImage[]
  // Index of the currently displayed image. When < 0 the lightbox is closed.
  index: number
  onClose: () => void
  onIndexChange?: (next: number) => void
}

// Fullscreen image viewer rendered via portal. Supports keyboard navigation
// (Esc to close, ←/→ to switch). Locks body scroll while open. The component
// is purely presentational — callers manage open/closed state via `index`.
export default function ImageLightbox({ images, index, onClose, onIndexChange }: Props) {
  const t = useT()
  const open = index >= 0 && index < images.length
  const total = images.length
  const canNavigate = total > 1 && Boolean(onIndexChange)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (canNavigate) {
        if (e.key === 'ArrowLeft') onIndexChange!((index - 1 + total) % total)
        if (e.key === 'ArrowRight') onIndexChange!((index + 1) % total)
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, index, total, canNavigate, onClose, onIndexChange])

  if (!open) return null

  const image = images[index]

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="image-lightbox"
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label={t('common.closeIt')}
          className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        {canNavigate && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onIndexChange!((index - 1 + total) % total)
              }}
              aria-label={t('lightbox.prev')}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onIndexChange!((index + 1) % total)
              }}
              aria-label={t('lightbox.next')}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white/90">
              {index + 1} / {total}
            </span>
          </>
        )}

        <motion.img
          key={image.src}
          src={image.src}
          alt={image.alt || ''}
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="max-h-[90vh] max-w-[95vw] cursor-zoom-out rounded object-contain shadow-elevation-16"
        />
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
