import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getPosts, setPostStatus, adminHardDeletePost } from '../../lib/api'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import { FileText } from '../../components/icons'
import { useT } from '../../lib/i18n'

export default function AdminPostsPage() {
  const t = useT()
  const qc = useQueryClient()

  const visibilityLabels: Record<string, string> = {
    public: t('admin.posts.visibilityPublic'),
    followers: t('admin.posts.visibilityFollowers'),
    private: t('admin.posts.visibilityPrivate'),
  }
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<string>('')
  const [confirmHardDelete, setConfirmHardDelete] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['adminPosts', status, cursor],
    queryFn: () => getPosts(status || undefined, cursor),
  })

  const statusMut = useMutation({
    mutationFn: ({ postId, status }: { postId: string; status: string }) =>
      setPostStatus(postId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminPosts'] }),
  })

  const hardDeleteMut = useMutation({
    mutationFn: (postId: string) => adminHardDeletePost(postId),
    onSuccess: () => {
      setConfirmHardDelete(null)
      qc.invalidateQueries({ queryKey: ['adminPosts'] })
    },
  })

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on">
            <FileText className="h-5 w-5" aria-hidden />
            {t('admin.posts.title')}
          </h1>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setCursor(undefined)
            }}
            className="bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary"
          >
            <option value="">{t('admin.posts.allStatuses')}</option>
            <option value="published">{t('admin.posts.statusPublished')}</option>
            <option value="hidden">{t('admin.posts.statusHidden')}</option>
            <option value="deleted">{t('admin.posts.statusDeleted')}</option>
          </select>
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : (
          <>
            <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-surface-on-variant">
                    <th className="py-3 px-4 font-medium">{t('admin.posts.colId')}</th>
                    <th className="py-3 px-4 font-medium">{t('admin.posts.colAuthor')}</th>
                    <th className="py-3 px-4 font-medium">{t('admin.posts.colContent')}</th>
                    <th className="py-3 px-4 font-medium w-24">{t('admin.posts.colVisibility')}</th>
                    <th className="py-3 px-4 font-medium w-24">{t('admin.posts.colStatus')}</th>
                    <th className="py-3 px-4 font-medium w-28">{t('admin.posts.colPostTime')}</th>
                    <th className="py-3 px-4 font-medium w-40">{t('admin.posts.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((post) => (
                    <tr key={post.id} className="border-b border-divider hover:bg-surface-variant/50">
                      <td className="py-3 px-4 text-surface-on-variant">{post.id}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-surface-on text-xs">@{post.author.username}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-surface-on truncate max-w-xs">{post.content || t('admin.posts.placeholderContent')}</p>
                      </td>
                      <td className="py-3 px-4 text-surface-on-variant">
                        {visibilityLabels[post.visibility] || post.visibility}
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={post.status || 'published'}
                          onChange={(e) => statusMut.mutate({ postId: post.id, status: e.target.value })}
                          className="text-xs bg-surface-variant rounded px-2 py-1"
                        >
                          <option value="published">{t('admin.posts.statusPublished')}</option>
                          <option value="hidden">{t('admin.posts.statusHidden')}</option>
                          <option value="deleted">{t('admin.posts.statusDeleted')}</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-surface-on-variant text-xs">
                        {new Date(post.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          {post.status === 'deleted' ? (
                            <button
                              onClick={() => statusMut.mutate({ postId: post.id, status: 'published' })}
                              className="text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded uppercase tracking-wider font-medium transition-colors"
                            >
                              {t('admin.posts.restore')}
                            </button>
                          ) : (
                            <button
                              onClick={() => statusMut.mutate({ postId: post.id, status: 'deleted' })}
                              className="text-xs text-error hover:bg-error/10 px-2 py-1 rounded uppercase tracking-wider font-medium transition-colors"
                            >
                              {t('common.delete')}
                            </button>
                          )}
                          {post.status === 'deleted' && (
                            <button
                              onClick={() => setConfirmHardDelete(post.id)}
                              className="text-xs text-error bg-error/10 hover:bg-error/20 px-2 py-1 rounded uppercase tracking-wider font-medium transition-colors"
                              title={t('admin.posts.hardDeleteTitle')}
                            >
                              {t('admin.posts.hardDelete')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data?.next_cursor && (
              <div className="flex justify-center gap-2 mt-4">
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

      {confirmHardDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !hardDeleteMut.isPending && setConfirmHardDelete(null)}
        >
          <div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-medium text-surface-on mb-2">{t('admin.posts.hardDeleteConfirmTitle')}</h3>
            <p className="text-sm text-error mb-4">
              {t('admin.posts.hardDeleteConfirmDesc')}
            </p>
            {hardDeleteMut.isError && (
              <p className="text-xs text-error mb-3">{(hardDeleteMut.error as Error).message}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmHardDelete(null)}
                disabled={hardDeleteMut.isPending}
                className="px-4 py-1.5 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => hardDeleteMut.mutate(confirmHardDelete)}
                disabled={hardDeleteMut.isPending}
                className="px-4 py-1.5 text-sm bg-error text-white rounded uppercase tracking-wider font-medium hover:bg-error/90 disabled:opacity-50"
              >
                {hardDeleteMut.isPending ? t('common.deleting') : t('admin.posts.hardDeleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
