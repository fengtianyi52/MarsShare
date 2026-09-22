import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DriveNode } from '../types'
import { getDriveTree } from '../lib/api'
import FileIcon from './FileIcon'
import { useT } from '../lib/i18n'

interface DriveFilePickerProps {
  open: boolean
  onClose: () => void
  onSelect: (files: DriveNode[]) => void
  multiple?: boolean
}

function flatten(nodes: DriveNode[]): DriveNode[] {
  const out: DriveNode[] = []
  const walk = (list: DriveNode[]) => {
    for (const n of list) {
      if (n.is_trashed) continue
      // Skip system-protected subtrees entirely (currently the per-user
      // "帖子图片" folder). Those files belong to inline post images and
      // shouldn't be re-attachable as regular post/comment attachments.
      if (n.is_system) continue
      if (!n.is_folder) out.push(n)
      if (n.children && n.children.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function DriveFilePicker({ open, onClose, onSelect, multiple = true }: DriveFilePickerProps) {
  const t = useT()
  const [selected, setSelected] = useState<Record<string, DriveNode>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['drivePickerTree'],
    queryFn: () => getDriveTree(),
    enabled: open,
  })

  useEffect(() => {
    if (!open) setSelected({})
  }, [open])

  const files = useMemo(() => (data ? flatten(data.items) : []), [data])

  if (!open) return null

  const toggle = (node: DriveNode) => {
    setSelected((prev) => {
      if (prev[node.id]) {
        const n = { ...prev }
        delete n[node.id]
        return n
      }
      if (!multiple) return { [node.id]: node }
      return { ...prev, [node.id]: node }
    })
  }

  const handleConfirm = () => {
    onSelect(Object.values(selected))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-surface rounded shadow-elevation-16 w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-divider">
          <h3 className="text-base font-medium text-surface-on">{t('drive.filePicker.title')}</h3>
          <p className="text-xs text-surface-on-variant mt-0.5">
            {multiple ? t('drive.filePicker.multiHint') : t('drive.filePicker.singleHint')}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-surface-on-variant">{t('common.loading')}</div>
          ) : files.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-surface-on-variant">{t('drive.filePicker.empty')}</div>
          ) : (
            <ul className="space-y-0.5">
              {files.map((f) => {
                const checked = Boolean(selected[f.id])
                return (
                  <li key={f.id}>
                    <label className="flex items-center gap-3 px-3 py-2 rounded hover:bg-surface-variant cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(f)}
                        className="accent-primary"
                      />
                      <FileIcon mimeType={f.mime_type || ''} className="h-5 w-5" />
                      <span className="flex-1 min-w-0 text-sm text-surface-on truncate">{f.name}</span>
                      <span className="text-xs text-surface-on-variant shrink-0">{formatSize(f.size)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-divider">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={Object.keys(selected).length === 0}
            className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {t('drive.filePicker.confirmWithCount', { count: Object.keys(selected).length })}
          </button>
        </div>
      </div>
    </div>
  )
}
