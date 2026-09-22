import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

export type ContextMenuItems = (ContextMenuItem | 'divider')[]

export interface ContextMenuProps {
  // Anchor coordinates in viewport space (e.clientX / e.clientY).
  x: number
  y: number
  items: ContextMenuItems
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // After mounting, clamp position so the menu doesn't overflow the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    const margin = 8
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    setPos({ left, top })
  }, [x, y])

  // Close on outside click, escape, scroll, resize.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Defer attaching the click listener so the same click that opened the menu
    // doesn't immediately close it.
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('contextmenu', handleClick)
    }, 0)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('contextmenu', handleClick)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        role="menu"
        style={{ left: pos.left, top: pos.top }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.12 }}
        className="fixed z-50 min-w-44 py-1 bg-surface rounded shadow-elevation-8 border border-outline-variant"
      >
        {items.map((item, i) => {
          if (item === 'divider') {
            return <div key={`d-${i}`} className="my-1 border-t border-divider" />
          }
          return (
            <button
              key={item.key}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                item.onClick()
                onClose()
              }}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
                item.disabled && 'opacity-40 cursor-not-allowed',
                !item.disabled && (item.danger
                  ? 'text-error hover:bg-error/10'
                  : 'text-surface-on hover:bg-surface-variant'),
              )}
            >
              {item.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          )
        })}
      </motion.div>
    </AnimatePresence>
  )
}
