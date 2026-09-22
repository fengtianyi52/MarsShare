import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTrash, restoreNode, purgeNode, emptyTrash } from '../lib/api'
import type { DriveNode } from '../types'
import FileIcon from './FileIcon'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './EmptyState'
import { Trash2 } from './icons'
import { useT } from '../lib/i18n'
import { useToast, useConfirm } from '../lib/notify'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

// DriveTrashPanel renders the recycle-bin contents (header + table) without
// any page chrome (AppShell). DrivePage embeds it inside its main content
// area when the user clicks the 回收站 entry in the sidebar; the standalone
// /drive/trash route wraps it in AppShell via DriveTrashPage.
export default function DriveTrashPanel() {
  const t = useT()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const { showConfirm } = useConfirm()
  const { data: nodes, isLoading } = useQuery({
    queryKey: ['driveTrash'],
    queryFn: getTrash,
  })

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['driveTrash'] })
    qc.invalidateQueries({ queryKey: ['driveTree'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreNode(id),
    onSuccess: invalidateAll,
    onError: (err: Error) => showToast({ type: 'error', message: err.message || t('drive.restoreFailed') }),
  })

  const purgeMut = useMutation({
    mutationFn: (id: string) => purgeNode(id),
    onSuccess: () => {
      showToast({ type: 'success', message: t('drive.purgeSuccess') })
      invalidateAll()
    },
    onError: (err: Error) => showToast({ type: 'error', message: err.message || t('drive.purgeFailed') }),
  })

  const emptyMut = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
      showToast({ type: 'success', message: t('drive.emptyTrashSuccess') })
      invalidateAll()
    },
    onError: (err: Error) => showToast({ type: 'error', message: err.message || t('drive.emptyTrashFailed') }),
  })

  const handlePurge = async (node: DriveNode) => {
    const ok = await showConfirm({
      title: t('drive.purgeTitle'),
      message: t('drive.purgeConfirm', { name: node.name }),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (ok) purgeMut.mutate(String(node.id))
  }

  const handleEmpty = async () => {
    const ok = await showConfirm({
      title: t('drive.emptyTrashTitle'),
      message: t('drive.emptyTrashConfirm'),
      confirmText: t('drive.emptyTrash'),
      danger: true,
    })
    if (ok) emptyMut.mutate()
  }

  const items = nodes?.items ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-divider">
        <h2 className="inline-flex items-center gap-2 text-sm font-medium text-surface-on">
          <Trash2 className="h-4 w-4" aria-hidden />
          {t('drive.trashTitle')}
        </h2>
        {items.length > 0 && (
          <button
            onClick={handleEmpty}
            disabled={emptyMut.isPending}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-error border border-error/40 rounded hover:bg-error/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t('drive.emptyTrash')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : items.length === 0 ? (
          <EmptyState icon={<Trash2 className="h-14 w-14" />} title={t('drive.trashEmpty')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-surface-on-variant">
                <th className="py-3 px-4 font-medium">{t('common.name')}</th>
                <th className="py-3 px-4 font-medium w-24">{t('common.size')}</th>
                <th className="py-3 px-4 font-medium w-32">{t('common.deleteTime')}</th>
                <th className="py-3 px-4 font-medium w-36 text-right">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((node: DriveNode) => (
                <tr key={node.id} className="border-b border-divider hover:bg-surface-variant/50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <FileIcon mimeType={node.mime_type || ''} isFolder={node.is_folder} className="h-5 w-5" />
                      <span>{node.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-surface-on-variant">
                    {node.is_folder ? '-' : formatBytes(node.size)}
                  </td>
                  <td className="py-3 px-4 text-surface-on-variant">
                    {node.trashed_at ? new Date(node.trashed_at).toLocaleDateString('zh-CN') : '-'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => restoreMut.mutate(String(node.id))}
                      disabled={restoreMut.isPending}
                      className="text-xs text-primary hover:underline mr-3"
                    >
                      {t('common.restore')}
                    </button>
                    <button
                      onClick={() => handlePurge(node)}
                      disabled={purgeMut.isPending}
                      className="text-xs text-error hover:underline"
                    >
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
