import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../lib/auth'
import { useTheme, type ThemeMode } from '../../lib/theme'
import { useT } from '../../lib/i18n'
import { getUnreadCount } from '../../lib/api'
import UserAvatar from '../UserAvatar'
import VipBadge from '../VipBadge'
import BannedBadge from '../BannedBadge'
import SearchBox from '../SearchBox'
import {
  Bell,
  User as UserIcon,
  Settings,
  Shield,
  LogOut,
  Sun,
  Moon,
  Monitor,
} from '../icons'
import clsx from 'clsx'

export default function Navbar() {
  const { user, isAuthenticated, logout, adminPath, siteName } = useAuth()
  const { mode, setMode } = useTheme()
  const t = useT()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data: unreadData } = useQuery({
    queryKey: ['unreadCount'],
    queryFn: getUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: 30000,
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="h-16 bg-primary text-primary-on flex items-center px-4 md:px-6 gap-4 sticky top-0 z-30 shadow-elevation-2">
      {/* Logo */}
      <Link to="/" className="text-lg font-bold shrink-0 hidden md:block">
        {siteName}
      </Link>

      {/* Search */}
      <SearchBox />

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        {isAuthenticated ? (
          <>
            {/* Notifications */}
            <Link
              to="/notifications"
              className="relative p-2 rounded-full hover:bg-white/15 transition-colors"
              aria-label={t('notifications.title')}
            >
              <Bell className="h-5 w-5" aria-hidden />
              {unreadData && unreadData.count > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-error text-error-on text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-primary">
                  {unreadData.count > 99 ? '99+' : unreadData.count}
                </span>
              )}
            </Link>

            {/* User menu — desktop hidden (moved to sidebar bottom),
                only shown on mobile (md:hidden) */}
            <div className="relative md:hidden" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 p-1 rounded-full hover:bg-white/15 transition-colors"
                aria-label={t('auth.userMenu')}
              >
                <UserAvatar
                  src={user?.avatar_url}
                  name={user?.display_name || ''}
                  size="sm"
                />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-surface text-surface-on rounded shadow-elevation-8 py-1 border border-divider overflow-hidden">
                  <div className="px-4 py-3 border-b border-divider">
                    <p className="inline-flex items-center gap-1 text-sm font-medium text-surface-on truncate">
                      {user?.display_name}
                      <VipBadge user={user} />
                      <BannedBadge user={user} />
                    </p>
                    <p className="text-xs text-surface-on-variant truncate">@{user?.username}</p>
                  </div>
                  <MenuItem
                    to={`/u/${user?.username}`}
                    icon={<UserIcon className="h-4 w-4" />}
                    label={t('nav.userProfile')}
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    to="/settings"
                    icon={<Settings className="h-4 w-4" />}
                    label={t('nav.settings')}
                    onClick={() => setMenuOpen(false)}
                  />
                  {user?.role === 'admin' && (
                    <MenuItem
                      to={`/${adminPath}`}
                      icon={<Shield className="h-4 w-4" />}
                      label={t('nav.admin')}
                      onClick={() => setMenuOpen(false)}
                    />
                  )}

                  {/* 主题切换 */}
                  <div className="border-t border-divider my-1" />
                  <div className="px-4 py-2 text-[11px] uppercase tracking-wider text-surface-on-variant">{t('theme.appearance')}</div>
                  <ThemeOption current={mode} value="light" icon={<Sun className="h-4 w-4" />} label={t('theme.light')} onSelect={setMode} />
                  <ThemeOption current={mode} value="dark" icon={<Moon className="h-4 w-4" />} label={t('theme.dark')} onSelect={setMode} />
                  <ThemeOption current={mode} value="system" icon={<Monitor className="h-4 w-4" />} label={t('theme.system')} onSelect={setMode} />

                  <div className="border-t border-divider my-1" />
                  <button
                    type="button"
                    onClick={() => { logout(); setMenuOpen(false); navigate('/') }}
                    className="flex items-center gap-3 w-full text-left px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>{t('auth.logout')}</span>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="px-4 py-2 text-sm rounded font-medium uppercase tracking-wider hover:bg-white/15 transition-colors"
            >
              {t('auth.login')}
            </Link>
            <Link
              to="/register"
              className="px-4 py-2 text-sm bg-white text-primary rounded font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 transition-shadow"
            >
              {t('auth.register')}
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}

function MenuItem({
  to,
  icon,
  label,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 text-sm text-surface-on hover:bg-surface-variant transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}

function ThemeOption({
  current,
  value,
  icon,
  label,
  onSelect,
}: {
  current: ThemeMode
  value: ThemeMode
  icon: React.ReactNode
  label: string
  onSelect: (m: ThemeMode) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={clsx(
        'flex items-center gap-3 w-full px-4 py-2 text-sm transition-colors',
        active ? 'text-primary bg-primary/10 font-medium' : 'text-surface-on hover:bg-surface-variant',
      )}
    >
      {icon}
      <span>{label}</span>
      {active && <span className="ml-auto h-2 w-2 rounded-full bg-primary" aria-hidden />}
    </button>
  )
}
