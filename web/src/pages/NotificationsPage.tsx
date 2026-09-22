import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNotifications, markRead, markAllRead } from '../lib/api'
import { useT } from '../lib/i18n'
import AppShell from '../components/layout/AppShell'
import NotificationItem from '../components/NotificationItem'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { Bell } from '../components/icons'

export default function NotificationsPage() {
  const t = useT()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(),
  })

  const markReadMut = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unreadCount'] })
    },
  })

  const markAllMut = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unreadCount'] })
    },
  })

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on">
            <Bell className="h-5 w-5" aria-hidden />
            {t('notifications.title')}
          </h1>
          {data && data.items.some((n) => !n.is_read) && (
            <button
              onClick={() => markAllMut.mutate()}
              disabled={markAllMut.isPending}
              className="text-sm text-primary hover:underline"
            >
              {t('notifications.markAllRead')}
            </button>
          )}
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={<Bell className="h-14 w-14" />} title={t('notifications.empty')} />
        ) : (
          <div className="bg-surface rounded shadow-elevation-1 divide-y divide-divider overflow-hidden">
            {data.items.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={(id) => markReadMut.mutate(String(id))}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
