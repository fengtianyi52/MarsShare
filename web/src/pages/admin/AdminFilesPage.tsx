import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminListFiles, adminDeleteFile, type AdminFileItem } from '../../lib/api'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import FileIcon from '../../components/FileIcon'
import { Folder, Trash2 } from '../../components/icons'
import clsx from 'clsx'
import { useT } from '../../lib/i18n'
import { useToast, useConfirm } from '../../lib/notify'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function objectKeyTail(key: string): string {
  if (!key) return ''
  const idx = key.lastIndexOf('/')
  return idx >= 0 ? key.slice(idx + 1) : key
}

const STATUS_OPTIONS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'admin.files.statusAll' },
  { value: 'active', labelKey: 'admin.files.statusActive' },
  { value: 'orphaned', labelKey: 'admin.files.statusOrphaned' },
  { value: 'deleted', labelKey: 'admin.files.statusDeleted' },
]

export default function AdminFilesPage() {
  const t = useT()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const { showConfirm } = useConfirm()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ['adminFiles', query, status, cursor],
    queryFn: () => adminListFiles({ query, status, cursor }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFile(id),
    onSuccess: () => {
      showToast({ type: 'success', message: t('admin.files.deleteSuccess') })
      qc.invalidateQueries({ queryKey: ['adminFiles'] })
    },
    onError: (err: Error) => showToast({ type: 'error', message: err.message || t('admin.files.deleteFailed') }),
  })

  const handleDelete = async (item: AdminFileItem) => {
    const ok = await showConfirm({
      title: t('admin.files.deleteTitle'),
      message: t('admin.files.deleteConfirm'),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (ok) deleteMut.mutate(item.id)
  }

  const items = data?.items ?? []

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <Folder className="h-5 w-5" aria-hidden />
          {t('admin.files.title')}
        </h1>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(undefined) }}
            placeholder={t('admin.files.searchPlaceholder')}
            className="flex-1 min-w-[240px] max-w-md bg-surface rounded px-4 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
          />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setCursor(undefined) }}
            className="bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : items.length === 0 ? (
          <EmptyState icon={<Folder className="h-14 w-14" />} title={t('admin.files.empty')} />
        ) : (
          <>
            <div className="bg-surface rounded shadow-elevation-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left text-surface-on-variant">
                    <th className="py-3 px-4 font-medium">{t('admin.files.colFile')}</th>
                    <th className="py-3 px-4 font-medium w-40">{t('admin.files.colOwner')}</th>
                    <th className="py-3 px-4 font-medium w-24">{t('admin.files.colSize')}</th>
                    <th className="py-3 px-4 font-medium w-44">{t('admin.files.colRefs')}</th>
                    <th className="py-3 px-4 font-medium w-24">{t('admin.files.colStatus')}</th>
                    <th className="py-3 px-4 font-medium w-32">{t('admin.files.colCreated')}</th>
                    <th className="py-3 px-4 font-medium w-24 text-right">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const tail = objectKeyTail(it.object_key)
                    return (
                      <tr key={it.id} className="border-b border-divider hover:bg-surface-variant/50">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileIcon mimeType={it.mime_type} className="h-5 w-5 shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate text-surface-on">{tail || it.id}</p>
                              <p className="truncate text-xs text-surface-on-variant" title={it.sha256}>
                                {it.mime_type || '-'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-surface-on">
                          <p className="truncate">{it.owner_display_name || it.owner_username || '-'}</p>
                          {it.owner_username && (
                            <p className="text-xs text-surface-on-variant truncate">@{it.owner_username}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-surface-on-variant">{formatBytes(it.size_bytes)}</td>
                        <td className="py-3 px-4 text-surface-on-variant">
                          <p className="text-xs">{t('admin.files.driveRefs', { count: it.drive_ref_count })}</p>
                          <p className="text-xs">{t('admin.files.postRefs', { count: it.post_ref_count })}</p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={clsx(
                            'text-xs px-2 py-0.5 rounded-full',
                            it.status === 'active'
                              ? 'bg-success/15 text-success'
                              : it.status === 'deleted'
                                ? 'bg-error/15 text-error'
                                : 'bg-warning/15 text-warning',
                          )}>
                            {it.status === 'active'
                              ? t('admin.files.statusActive')
                              : it.status === 'deleted'
                                ? t('admin.files.statusDeleted')
                                : t('admin.files.statusOrphaned')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-surface-on-variant text-xs">
                          {new Date(it.created_at).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDelete(it)}
                            disabled={deleteMut.isPending || it.status === 'deleted'}
                            className="inline-flex items-center gap-1 text-xs text-error hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            {t('common.delete')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {data?.next_cursor && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => setCursor(data.next_cursor)}
                  className="px-3 py-1.5 text-sm rounded bg-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {t('admin.files.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
