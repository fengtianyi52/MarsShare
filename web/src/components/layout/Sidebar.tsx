import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getHotSearches } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import SidebarUserCard from './SidebarUserCard'
import { Home, Users, Flame, HardDrive, Crown, LinkIcon, type LucideIcon } from '../icons'
import clsx from 'clsx'

interface NavItem {
  Icon: LucideIcon
  labelKey: string
  to: string
  auth?: boolean
}

const navItems: NavItem[] = [
  { Icon: Home, labelKey: 'nav.home', to: '/' },
  { Icon: Users, labelKey: 'nav.feed', to: '/feed', auth: true },
  { Icon: Flame, labelKey: 'nav.trending', to: '/trending' },
  { Icon: HardDrive, labelKey: 'nav.drive', to: '/drive', auth: true },
  { Icon: LinkIcon, labelKey: 'nav.myShares', to: '/shares', auth: true },
  { Icon: Crown, labelKey: 'nav.membership', to: '/membership', auth: true },
]

export default function Sidebar() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()
  const t = useT()

  const { data: hotSearches } = useQuery({
    queryKey: ['hotSearches'],
    queryFn: getHotSearches,
    staleTime: 60000,
  })

  return (
    <aside className="w-64 shrink-0 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto bg-surface border-r border-divider hidden md:flex flex-col scrollbar-thin">
      {/* Navigation */}
      <nav className="p-3 space-y-1">
        {navItems
          .filter((item) => !item.auth || isAuthenticated)
          .map((item) => {
            const { Icon } = item
            const active = location.pathname === item.to ||
              (item.to !== '/' && location.pathname.startsWith(item.to))
            return (
              <Link
                key={item.to}
                to={item.to}
                className={clsx(
                  'relative flex items-center gap-3 px-4 py-2.5 rounded text-sm font-medium transition-colors overflow-hidden',
                  active
                    ? 'bg-primary/10 text-primary before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-primary'
                    : 'text-surface-on hover:bg-surface-variant',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{t(item.labelKey as any)}</span>
              </Link>
            )
          })}
      </nav>

      {/* Hot searches */}
      {hotSearches && hotSearches.length > 0 && (
        <div className="px-4 py-3 mt-2">
          <h3 className="text-xs font-medium text-surface-on-variant uppercase tracking-wider mb-2">
            {t('search.hotList')}
          </h3>
          <div className="space-y-1">
            {hotSearches.slice(0, 8).map((h, idx) => {
              const to =
                h.link_type === 'topic'
                  ? `/topics/${h.link_value}`
                  : h.link_type === 'url'
                    ? h.link_value
                    : `/search?q=${encodeURIComponent(h.link_value || h.keyword)}`
              return (
                <Link
                  key={h.id}
                  to={to}
                  className="flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-surface-variant transition-colors"
                >
                  <span
                    className={clsx(
                      'w-5 text-center text-xs font-bold tabular-nums',
                      idx < 3 ? 'text-error' : 'text-surface-on-variant',
                    )}
                  >
                    {idx + 1}
                  </span>
                  <span className="truncate text-primary">{h.keyword}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* User card (with secondary panel containing storage / settings / logout) */}
      {isAuthenticated && (
        <div className="mt-auto p-2 border-t border-divider">
          <SidebarUserCard />
        </div>
      )}
    </aside>
  )
}
