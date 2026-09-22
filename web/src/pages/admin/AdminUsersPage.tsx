import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsers, setBan, setMute } from '../../lib/api'
import AppShell from '../../components/layout/AppShell'
import UserAvatar from '../../components/UserAvatar'
import VipBadge from '../../components/VipBadge'
import BannedBadge from '../../components/BannedBadge'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Users } from '../../components/icons'
import clsx from 'clsx'
import type { User } from '../../types'
import { useT } from '../../lib/i18n'

// ─── Mute dialog ──────────────────────────────────────────
interface MuteDialogProps {
  user: User
  onConfirm: (mutedUntil: string | null) => void
  onCancel: () => void
}

function MuteDialog({ user, onConfirm, onCancel }: MuteDialogProps) {
  const t = useT()
  const [selectedHours, setSelectedHours] = useState<number | null>(24)

  const durations: { label: string; hours: number | null }[] = [
    { label: t('user.muteHour', { n: 1 }), hours: 1 },
    { label: t('user.muteHour', { n: 24 }), hours: 24 },
    { label: t('user.muteDay', { n: 7 }), hours: 24 * 7 },
    { label: t('user.muteDay', { n: 30 }), hours: 24 * 30 },
    { label: t('user.mutePermanent'), hours: null },
  ]

  const handleConfirm = () => {
    if (selectedHours === null) {
      onConfirm(null)
    } else {
      const until = new Date(Date.now() + selectedHours * 3600 * 1000).toISOString()
      onConfirm(until)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-lg shadow-elevation-3 p-6 w-full max-w-sm mx-4">
        <h3 className="text-base font-semibold text-surface-on mb-1">{t('user.muteDialogTitle')}</h3>
        <p className="text-sm text-surface-on-variant mb-4">
          {t('user.muteDialogDesc', { username: user.username })}
        </p>

        <p className="text-xs font-medium text-surface-on-variant mb-2">{t('user.muteDuration')}</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {durations.map((d) => (
            <button
              key={String(d.hours)}
              onClick={() => setSelectedHours(d.hours)}
              className={clsx(
                'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                selectedHours === d.hours
                  ? 'bg-warning text-white'
                  : 'bg-surface-variant text-surface-on-variant hover:bg-surface-variant/80',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded text-surface-on-variant hover:bg-surface-variant transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm rounded bg-warning text-white hover:bg-warning/90 font-medium transition-colors"
          >
            {t('user.muteConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────

export default function AdminUsersPage() {
  const t = useT()
  const qc = useQueryClient()
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [muteTarget, setMuteTarget] = useState<User | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['adminUsers', cursor, search],
    queryFn: () => getUsers(cursor, search),
  })

  const banMut = useMutation({
    mutationFn: ({ userId, banned }: { userId: string; banned: boolean }) => setBan(userId, banned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminUsers'] }),
  })

  const muteMut = useMutation({
    mutationFn: ({ userId, muted, mutedUntil }: { userId: string; muted: boolean; mutedUntil?: string | null }) =>
      setMute(userId, muted, mutedUntil),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adminUsers'] })
      setMuteTarget(null)
    },
  })

  const handleMuteConfirm = (mutedUntil: string | null) => {
    if (!muteTarget) return
    muteMut.mutate({ userId: muteTarget.id, muted: true, mutedUntil })
  }

  const isMutedActive = (user: User) => {
    if (!user.is_muted) return false
    if (!user.muted_until) return true
    return new Date(user.muted_until).getTime() > Date.now()
  }

  return (
    <AppShell>
      {muteTarget && (
        <MuteDialog
          user={muteTarget}
          onConfirm={handleMuteConfirm}
          onCancel={() => setMuteTarget(null)}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <Users className="h-5 w-5" aria-hidden />
          {t('admin.users.title')}
        </h1>

        {/* Search */}
        <div className="mb-4">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCursor(undefined) }}
            placeholder={t('admin.users.searchPlaceholder')}
            className="w-full max-w-sm bg-surface rounded px-4 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
          />
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : (
          <>
            <div className="bg-surface rounded shadow-elevation-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-surface-on-variant">
                    <th className="py-3 px-4 font-medium">{t('admin.users.colUser')}</th>
                    <th className="py-3 px-4 font-medium">{t('admin.users.colEmail')}</th>
                    <th className="py-3 px-4 font-medium w-20">{t('admin.users.colRole')}</th>
                    <th className="py-3 px-4 font-medium w-20">{t('admin.users.colAccountStatus')}</th>
                    <th className="py-3 px-4 font-medium w-20">{t('admin.users.colMuteStatus')}</th>
                    <th className="py-3 px-4 font-medium w-28">{t('admin.users.colCreatedAt')}</th>
                    <th className="py-3 px-4 font-medium w-36">{t('admin.users.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((u) => {
                    const activeMuted = isMutedActive(u)
                    return (
                      <tr key={u.id} className="border-b border-divider hover:bg-surface-variant/50">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <UserAvatar src={u.avatar_url} name={u.display_name} size="sm" />
                            <div>
                              <p className="inline-flex items-center gap-1 font-medium text-surface-on">
                                {u.display_name}
                                <VipBadge user={u} />
                                <BannedBadge user={u} />
                              </p>
                              <p className="text-xs text-surface-on-variant">@{u.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-surface-on-variant">{u.email}</td>
                        <td className="py-3 px-4">
                          <span className={clsx(
                            'text-xs px-2 py-0.5 rounded-full',
                            u.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-surface-variant text-surface-on-variant',
                          )}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={clsx(
                            'text-xs px-2 py-0.5 rounded-full',
                            u.is_banned ? 'bg-error/15 text-error' : 'bg-success/15 text-success',
                          )}>
                            {u.is_banned ? t('user.bannedStatus') : t('common.normal')}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {activeMuted ? (
                            <div>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                                {t('user.mutedStatus')}
                              </span>
                              {u.muted_until && (
                                <p className="text-xs text-surface-on-variant mt-0.5">
                                  {t('user.muteDurationUntil', { date: new Date(u.muted_until).toLocaleDateString('zh-CN') })}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-surface-on-variant">{t('common.dash')}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-surface-on-variant text-xs">
                          {new Date(u.created_at).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            {/* Ban / Unban */}
                            <button
                              onClick={() => banMut.mutate({ userId: u.id, banned: !u.is_banned })}
                              disabled={banMut.isPending || u.role === 'admin'}
                              title={u.role === 'admin' ? t('user.cannotBanAdmin') : undefined}
                              className={clsx(
                                'text-xs px-2 py-1 rounded font-medium transition-colors disabled:opacity-40',
                                u.is_banned
                                  ? 'text-primary hover:bg-primary/10'
                                  : 'text-error hover:bg-error/10',
                              )}
                            >
                              {u.is_banned ? t('user.unbanAction') : t('user.banAction')}
                            </button>

                            {/* Mute / Unmute */}
                            {activeMuted ? (
                              <button
                                onClick={() => muteMut.mutate({ userId: u.id, muted: false })}
                                disabled={muteMut.isPending}
                                className="text-xs px-2 py-1 rounded font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                              >
                                {t('user.unmuteAction')}
                              </button>
                            ) : (
                              <button
                                onClick={() => setMuteTarget(u)}
                                disabled={u.role === 'admin'}
                                title={u.role === 'admin' ? t('user.cannotMuteAdmin') : undefined}
                                className="text-xs px-2 py-1 rounded font-medium text-warning hover:bg-warning/10 transition-colors disabled:opacity-40"
                              >
                                {t('user.muteAction')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data && data.items.length > 0 && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => {
                    const lastItem = data.items[data.items.length - 1]
                    if (lastItem) setCursor(String(lastItem.id))
                  }}
                  className="px-3 py-1.5 text-sm rounded bg-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {t('common.nextPage')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
