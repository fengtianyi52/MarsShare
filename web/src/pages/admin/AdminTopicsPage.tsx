import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminListTopics, adminBanTopic, adminDeleteTopic } from '../../lib/api'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Flame } from '../../components/icons'
import { useT } from '../../lib/i18n'

export default function AdminTopicsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['adminTopics', cursor],
    queryFn: () => adminListTopics(cursor),
  })

  const banMut = useMutation({
    mutationFn: ({ topicId, banned }: { topicId: string; banned: boolean }) =>
      adminBanTopic(topicId, banned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminTopics'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (topicId: string) => adminDeleteTopic(topicId),
    onSuccess: () => {
      setConfirmDelete(null)
      qc.invalidateQueries({ queryKey: ['adminTopics'] })
    },
  })

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <Flame className="h-5 w-5 text-error" aria-hidden />
          {t('admin.topics.title')}
        </h1>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : (
          <>
            <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-surface-on-variant">
                    <th className="py-3 px-4 font-medium">{t('admin.topics.colTopic')}</th>
                    <th className="py-3 px-4 font-medium w-24 text-right">{t('admin.topics.colPostCount')}</th>
                    <th className="py-3 px-4 font-medium w-24 text-right">{t('admin.topics.colFollowerCount')}</th>
                    <th className="py-3 px-4 font-medium w-24">{t('admin.topics.colStatus')}</th>
                    <th className="py-3 px-4 font-medium w-28">{t('admin.topics.colCreatedAt')}</th>
                    <th className="py-3 px-4 font-medium w-40">{t('admin.topics.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((topic) => (
                    <tr
                      key={topic.id}
                      className={`border-b border-divider hover:bg-surface-variant/50 ${topic.is_banned ? 'opacity-50' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <p className="font-medium text-surface-on">#{topic.name}#</p>
                        <p className="text-xs text-surface-on-variant">{topic.slug}</p>
                        {topic.description && (
                          <p className="text-xs text-surface-on-variant/70 truncate max-w-xs mt-0.5">
                            {topic.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-surface-on-variant tabular-nums">
                        {topic.post_count.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-surface-on-variant tabular-nums">
                        {topic.follower_count.toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        {topic.is_banned ? (
                          <span className="text-xs text-error font-medium">{t('user.bannedStatus')}</span>
                        ) : (
                          <span className="text-xs text-primary font-medium">{t('common.normal')}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-surface-on-variant text-xs">
                        {new Date(topic.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => banMut.mutate({ topicId: topic.id, banned: !topic.is_banned })}
                            disabled={banMut.isPending}
                            className={`text-xs px-2 py-1 rounded font-medium uppercase tracking-wider transition-colors ${
                              topic.is_banned
                                ? 'text-primary hover:bg-primary/10'
                                : 'text-warning hover:bg-warning/10'
                            }`}
                          >
                            {topic.is_banned ? t('user.unbanAction') : t('user.banAction')}
                          </button>
                          <button
                            onClick={() => setConfirmDelete({ id: topic.id, name: topic.name })}
                            className="text-xs text-error hover:bg-error/10 px-2 py-1 rounded font-medium uppercase tracking-wider transition-colors"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data?.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-surface-on-variant">
                        {t('admin.topics.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data?.next_cursor && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => setCursor(data.next_cursor)}
                  className="px-3 py-1.5 text-sm rounded bg-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {t('common.nextPage')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !deleteMut.isPending && setConfirmDelete(null)}
        >
          <div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-medium text-surface-on mb-2">{t('admin.topics.deleteConfirmTitle')}</h3>
            <p className="text-sm text-surface-on-variant mb-1">
              {t('admin.topics.deleteConfirmName', { name: confirmDelete.name })}
            </p>
            <p className="text-sm text-error mb-4">
              {t('admin.topics.deleteConfirmDesc')}
            </p>
            {deleteMut.isError && (
              <p className="text-xs text-error mb-3">{(deleteMut.error as Error).message}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleteMut.isPending}
                className="px-4 py-1.5 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => deleteMut.mutate(confirmDelete.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-1.5 text-sm bg-error text-white rounded uppercase tracking-wider font-medium hover:bg-error/90 disabled:opacity-50"
              >
                {deleteMut.isPending ? t('common.deleting') : t('admin.topics.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
