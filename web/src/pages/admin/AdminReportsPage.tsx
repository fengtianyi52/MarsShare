import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getReports, resolveReport } from '../../lib/api'
import type { Report } from '../../types'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { Flag, ExternalLink } from '../../components/icons'
import clsx from 'clsx'
import { useT } from '../../lib/i18n'

// Resolve the URL to navigate to in order to view the offending content.
// Returns null when the target can't be located (e.g. the reporter pointed at
// something that has since been deleted, or backend didn't supply enough info).
function targetHref(r: Report): string | null {
  if (r.target_deleted) return null
  switch (r.target_type) {
    case 'post':
      return r.target_post_id ? `/post/${r.target_post_id}` : `/post/${r.target_id}`
    case 'comment':
      // Comment reports link to the parent post; the comment renders inline there.
      return r.target_post_id ? `/post/${r.target_post_id}#comment-${r.target_id}` : null
    case 'user':
      return r.target_username ? `/u/${r.target_username}` : null
    default:
      return null
  }
}

export default function AdminReportsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const statusLabels: Record<string, string> = {
    pending: t('admin.reports.statusPending'),
    resolved: t('admin.reports.statusResolved'),
    dismissed: t('admin.reports.statusDismissed'),
  }

  const targetTypeLabels: Record<string, string> = {
    post: t('admin.reports.targetPost'),
    comment: t('admin.reports.targetComment'),
    user: t('admin.reports.targetUser'),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['adminReports', cursor],
    queryFn: () => getReports(undefined, cursor),
    // Auto-poll every 30s and refresh when the tab regains focus so admins
    // see new reports without manually reloading.
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  const resolveMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'resolved' | 'dismissed' }) =>
      resolveReport(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminReports'] }),
  })

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <Flag className="h-5 w-5" aria-hidden />
          {t('admin.reports.title')}
        </h1>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={<Flag className="h-14 w-14" />} title={t('admin.reports.empty')} />
        ) : (
          <>
            <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-surface-on-variant">
                    <th className="py-3 px-4 font-medium">{t('admin.reports.colReporter')}</th>
                    <th className="py-3 px-4 font-medium w-20">{t('admin.reports.colType')}</th>
                    <th className="py-3 px-4 font-medium">{t('admin.reports.colTarget')}</th>
                    <th className="py-3 px-4 font-medium">{t('admin.reports.colReason')}</th>
                    <th className="py-3 px-4 font-medium w-20">{t('admin.reports.colStatus')}</th>
                    <th className="py-3 px-4 font-medium w-28">{t('admin.reports.colTime')}</th>
                    <th className="py-3 px-4 font-medium w-36">{t('admin.reports.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => {
                    const href = targetHref(r)
                    return (
                      <tr key={r.id} className="border-b border-divider hover:bg-surface-variant/50">
                        <td className="py-3 px-4 text-surface-on">@{r.reporter.username}</td>
                        <td className="py-3 px-4 text-surface-on-variant">
                          {targetTypeLabels[r.target_type] || r.target_type}
                        </td>
                        <td className="py-3 px-4">
                          {r.target_deleted ? (
                            <span className="text-xs text-surface-on-variant italic">{t('admin.reports.targetDeleted')}</span>
                          ) : href ? (
                            <Link
                              to={href}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              title={t('admin.reports.viewTargetTitle')}
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden />
                              {r.target_type === 'user' && r.target_username
                                ? `@${r.target_username}`
                                : t('admin.reports.viewTarget')}
                            </Link>
                          ) : (
                            <span className="text-xs text-surface-on-variant font-mono truncate">
                              {r.target_id.slice(0, 8)}…
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-surface-on truncate max-w-[220px]">{r.reason}</td>
                        <td className="py-3 px-4">
                          <span
                            className={clsx(
                              'text-xs px-2 py-0.5 rounded-full',
                              r.status === 'pending'
                                ? 'bg-warning/15 text-warning'
                                : r.status === 'resolved'
                                  ? 'bg-success/15 text-success'
                                  : 'bg-surface-variant text-surface-on-variant',
                            )}
                          >
                            {statusLabels[r.status]}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-surface-on-variant text-xs">
                          {new Date(r.created_at).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="py-3 px-4">
                          {r.status === 'pending' && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => resolveMut.mutate({ id: String(r.id), status: 'resolved' })}
                                className="text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors"
                              >
                                {t('admin.reports.resolve')}
                              </button>
                              <button
                                onClick={() => resolveMut.mutate({ id: String(r.id), status: 'dismissed' })}
                                className="text-xs text-surface-on-variant hover:bg-surface-variant px-2 py-1 rounded transition-colors"
                              >
                                {t('admin.reports.dismiss')}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {data.items.length > 0 && (
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
