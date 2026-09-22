import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { Home, Flame, Pencil, HardDrive, User, type LucideIcon } from '../icons'
import clsx from 'clsx'

interface NavItem {
  Icon: LucideIcon
  labelKey: string
  to: string
}

const items: NavItem[] = [
  { Icon: Home, labelKey: 'nav.home', to: '/' },
  { Icon: Flame, labelKey: 'nav.trending', to: '/trending' },
  { Icon: Pencil, labelKey: '', to: '__fab__' },
  { Icon: HardDrive, labelKey: 'nav.drive', to: '/drive' },
  { Icon: User, labelKey: 'nav.profile', to: '__profile__' },
]

export default function MobileBottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const t = useT()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-divider flex items-center justify-around px-2 py-1 shadow-elevation-4">
      {items.map((item, i) => {
        const { Icon } = item
        if (item.to === '__fab__') {
          return (
            <motion.button
              key={i}
              type="button"
              onClick={() => {
                if (isAuthenticated) navigate('/feed')
                else navigate('/login')
              }}
              whileTap={{ scale: 0.92 }}
              whileHover={{ y: -2 }}
              className="relative -top-4 w-14 h-14 bg-primary rounded-full flex items-center justify-center shadow-elevation-4 text-primary-on hover:bg-primary-dark"
              aria-label={t('nav.publish')}
            >
              <Icon className="h-6 w-6" />
            </motion.button>
          )
        }

        const to = item.to === '__profile__'
          ? (isAuthenticated ? `/u/${user?.username}` : '/login')
          : item.to
        const active = location.pathname === to

        return (
          <Link
            key={i}
            to={to}
            className="flex flex-col items-center gap-0.5 py-1 px-3 min-w-[48px]"
          >
            <span
              className={clsx(
                'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                active ? 'bg-primary/15 text-primary' : 'text-surface-on-variant',
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className={clsx(
              'text-xs',
              active ? 'text-primary font-medium' : 'text-surface-on-variant',
            )}>
              {item.labelKey ? t(item.labelKey as any) : ''}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
