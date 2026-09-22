import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { useAuth } from '../../lib/auth'
import { useTheme, type ThemeMode } from '../../lib/theme'
import { useT } from '../../lib/i18n'
import UserAvatar from '../UserAvatar'
import VipBadge from '../VipBadge'
import BannedBadge from '../BannedBadge'
import StorageQuotaBar from '../StorageQuotaBar'
import {
  ChevronUp,
  User as UserIcon,
  Settings,
  Shield,
  LogOut,
  Sun,
  Moon,
  Monitor,
} from '../icons'

export default function SidebarUserCard() {
  const { user, logout, adminPath } = useAuth()
  const { mode, setMode } = useTheme()
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (!user) return null

  return (
    <div className="relative" ref={wrapperRef}>
      {/* Trigger card */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('auth.userMenu')}
        className={clsx(
          'flex items-center gap-3 w-full px-3 py-2.5 rounded text-left transition-colors',
          open ? 'bg-surface-variant' : 'hover:bg-surface-variant',
        )}
      >
        <UserAvatar src={user.avatar_url} name={user.display_name} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1 max-w-full">
            <span className="text-sm font-medium text-surface-on truncate">
              {user.display_name}
            </span>
            <VipBadge user={user} />
            <BannedBadge user={user} />
          </div>
          <p className="text-xs text-surface-on-variant truncate">@{user.username}</p>
        </div>
        <ChevronUp
          className={clsx(
            'h-4 w-4 text-surface-on-variant transition-transform shrink-0',
            !open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {/* Pop-out secondary panel — anchored above the card */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="absolute left-0 right-0 bottom-full mb-2 bg-surface text-surface-on rounded shadow-elevation-8 border border-divider overflow-hidden"
            role="menu"
          >
            {/* Storage quota */}
            <div className="px-4 py-3 border-b border-divider">
              <p className="text-[11px] uppercase tracking-wider text-surface-on-variant mb-1.5">
                {t('storage.title')}
              </p>
              <StorageQuotaBar used={user.storage_used} total={user.storage_limit} />
            </div>

            {/* Navigation items */}
            <div className="py-1">
              <SubMenuLink
                to={`/u/${user.username}`}
                icon={<UserIcon className="h-4 w-4" />}
                label={t('nav.userProfile')}
                onClick={() => setOpen(false)}
              />
              <SubMenuLink
                to="/membership"
                icon={<Shield className="h-4 w-4" />}
                label={t('nav.myMembership')}
                onClick={() => setOpen(false)}
              />
              <SubMenuLink
                to="/settings"
                icon={<Settings className="h-4 w-4" />}
                label={t('nav.settings')}
                onClick={() => setOpen(false)}
              />
              {user.role === 'admin' && (
                <SubMenuLink
                  to={`/${adminPath}`}
                  icon={<Shield className="h-4 w-4" />}
                  label={t('nav.admin')}
                  onClick={() => setOpen(false)}
                />
              )}
            </div>

            {/* Theme picker */}
            <div className="border-t border-divider py-1">
              <div className="px-4 py-1 text-[11px] uppercase tracking-wider text-surface-on-variant">
                {t('theme.appearance')}
              </div>
              <ThemeOption current={mode} value="light" icon={<Sun className="h-4 w-4" />} label={t('theme.light')} onSelect={setMode} />
              <ThemeOption current={mode} value="dark" icon={<Moon className="h-4 w-4" />} label={t('theme.dark')} onSelect={setMode} />
              <ThemeOption current={mode} value="system" icon={<Monitor className="h-4 w-4" />} label={t('theme.system')} onSelect={setMode} />
            </div>

            {/* Logout */}
            <div className="border-t border-divider">
              <button
                type="button"
                onClick={() => {
                  logout()
                  setOpen(false)
                  navigate('/')
                }}
                className="flex items-center gap-3 w-full text-left px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span>{t('auth.logout')}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SubMenuLink({
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
      role="menuitem"
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
      role="menuitem"
    >
      {icon}
      <span>{label}</span>
      {active && <span className="ml-auto h-2 w-2 rounded-full bg-primary" aria-hidden />}
    </button>
  )
}
