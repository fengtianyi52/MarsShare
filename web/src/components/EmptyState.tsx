import type { ReactNode } from 'react'
import { Inbox } from './icons'

interface Props {
  icon?: ReactNode
  title: string
  description?: string
}

export default function EmptyState({ icon, title, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 text-surface-on-variant">
        {icon ?? <Inbox className="h-14 w-14" aria-hidden />}
      </div>
      <h3 className="text-lg font-medium text-surface-on">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-surface-on-variant">{description}</p>
      )}
    </div>
  )
}
