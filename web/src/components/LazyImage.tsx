import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'

interface Props {
  src: string
  alt: string
  className?: string
  fallback?: React.ReactNode
}

export default function LazyImage({ src, alt, className, fallback }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const imgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = imgRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState('loading')
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleLoad = () => setState('loaded')
  const handleError = () => setState('error')

  return (
    <div ref={imgRef} className={clsx('overflow-hidden relative', className)}>
      {/* Placeholder background shown while idle or loading */}
      {state !== 'loaded' && state !== 'error' && (
        <div className="absolute inset-0 bg-surface-variant animate-pulse rounded" />
      )}

      {/* Error fallback */}
      {state === 'error' && (
        fallback ?? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-variant rounded text-surface-on-variant text-sm">
            Failed to load
          </div>
        )
      )}

      {/* Actual image - only rendered once IntersectionObserver triggers */}
      {(state === 'loading' || state === 'loaded') && (
        <img
          src={src}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          className={clsx(
            'w-full h-full object-cover transition-opacity duration-300',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  )
}
