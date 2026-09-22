import clsx from 'clsx'
import { Ban } from './icons'
import { useT } from '../lib/i18n'
import type { User } from '../types'

interface Props {
  user?: Pick<User, 'is_banned'> | null
  // sm = inline next to a name; md = larger pill
  size?: 'sm' | 'md'
  className?: string
}

// Small red "封禁中" badge rendered next to a banned user's name. Mirrors the
// VipBadge API so callers can drop it in unconditionally — returns null when
// the user is not banned.
export default function BannedBadge({ user, size = 'sm', className }: Props) {
  const t = useT()
  if (!user || !user.is_banned) return null
  const title = t('user.bannedTitle')

  if (size === 'md') {
    return (
      <span
        title={title}
        aria-label={t('user.bannedBadge')}
        className={clsx(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          'bg-error text-error-on shadow-elevation-1',
          className,
        )}
      >
        <Ban className="h-3 w-3" aria-hidden />
        {t('user.bannedBadge')}
      </span>
    )
  }

  return (
    <span
      title={title}
      aria-label={t('user.bannedBadge')}
      className={clsx(
        'inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-bold leading-none align-middle',
        'bg-error text-error-on',
        className,
      )}
    >
      <Ban className="h-2.5 w-2.5" aria-hidden />
      {t('user.bannedBadge')}
    </span>
  )
}
