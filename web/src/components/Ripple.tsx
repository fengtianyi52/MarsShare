import { useCallback, useState, type CSSProperties, type MouseEvent } from 'react'

interface RippleSpec {
  id: number
  x: number
  y: number
  size: number
}

interface UseRippleReturn {
  ripples: RippleSpec[]
  onPointerDown: (e: MouseEvent<HTMLElement>) => void
  containerProps: {
    onPointerDown: (e: MouseEvent<HTMLElement>) => void
  }
}

let rippleSeq = 0

/**
 * MD2 风格点击波纹 hook,使用纯 CSS 动画(由 tailwind keyframe ripple-expand 提供)
 * 使用方式:
 *   const ripple = useRipple()
 *   <button {...ripple.containerProps} className="ripple-host">
 *     <RippleLayer ripples={ripple.ripples} />
 *     ...
 *   </button>
 */
export function useRipple(): UseRippleReturn {
  const [ripples, setRipples] = useState<RippleSpec[]>([])

  const onPointerDown = useCallback((e: MouseEvent<HTMLElement>) => {
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const x = e.clientX - rect.left - size / 2
    const y = e.clientY - rect.top - size / 2
    const spec: RippleSpec = { id: ++rippleSeq, x, y, size }
    setRipples((prev) => [...prev, spec])
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== spec.id))
    }, 650)
  }, [])

  return {
    ripples,
    onPointerDown,
    containerProps: { onPointerDown },
  }
}

interface RippleLayerProps {
  ripples: RippleSpec[]
  /** ripple 颜色,默认 currentColor 半透明 */
  color?: string
}

export function RippleLayer({ ripples, color = 'currentColor' }: RippleLayerProps) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {ripples.map((r) => {
        const style: CSSProperties = {
          left: r.x,
          top: r.y,
          width: r.size,
          height: r.size,
          background: color,
        }
        return (
          <span
            key={r.id}
            className="absolute rounded-full opacity-30 animate-ripple-expand"
            style={style}
          />
        )
      })}
    </span>
  )
}

interface RippleProps {
  className?: string
  color?: string
  children: React.ReactNode
}

/**
 * 简化封装:直接给一个 div 加 ripple 效果
 */
export default function Ripple({ className = '', color, children }: RippleProps) {
  const ripple = useRipple()
  return (
    <div className={`ripple-host ${className}`} {...ripple.containerProps}>
      {children}
      <RippleLayer ripples={ripple.ripples} color={color} />
    </div>
  )
}
