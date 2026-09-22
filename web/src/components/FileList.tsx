import type { MouseEvent } from 'react'
import clsx from 'clsx'
import type { DriveNode } from '../types'
import FileIcon from './FileIcon'
import { FolderOpen } from './icons'
import { useT } from '../lib/i18n'

interface Props {
  nodes: DriveNode[]
  view: 'grid' | 'list'
  selectedIds: Set<string>
  onOpen: (node: DriveNode) => void
  onSelect: (node: DriveNode, mods: { ctrl: boolean; shift: boolean }) => void
  onContextMenu: (node: DriveNode, e: MouseEvent) => void
  onBlankContextMenu?: (e: MouseEvent) => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

export default function FileList({
  nodes,
  view,
  selectedIds,
  onOpen,
  onSelect,
  onContextMenu,
  onBlankContextMenu,
}: Props) {
  const t = useT()
  if (nodes.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-surface-on-variant"
        onContextMenu={(e) => {
          if (onBlankContextMenu) {
            e.preventDefault()
            onBlankContextMenu(e)
          }
        }}
      >
        <FolderOpen className="h-12 w-12 mb-3" aria-hidden />
        <p className="text-sm">{t('drive.emptyFolder')}</p>
      </div>
    )
  }

  const handleClick = (node: DriveNode) => (e: MouseEvent) => {
    onSelect(node, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
  }

  const handleDoubleClick = (node: DriveNode) => () => {
    onOpen(node)
  }

  const handleRowContextMenu = (node: DriveNode) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(node, e)
  }

  const handleBlankBg = (e: MouseEvent) => {
    if (onBlankContextMenu) {
      e.preventDefault()
      onBlankContextMenu(e)
    }
  }

  if (view === 'grid') {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 min-h-[40vh]"
        onContextMenu={handleBlankBg}
      >
        {nodes.map((node) => {
          const selected = selectedIds.has(node.id)
          return (
            <div
              key={node.id}
              onClick={handleClick(node)}
              onDoubleClick={handleDoubleClick(node)}
              onContextMenu={handleRowContextMenu(node)}
              className={clsx(
                'group relative flex flex-col items-center gap-2 p-4 rounded text-center cursor-pointer transition-colors select-none',
                selected
                  ? 'bg-primary/15 ring-1 ring-primary'
                  : 'hover:bg-surface-variant/60',
              )}
            >
              <FileIcon mimeType={node.mime_type || ''} isFolder={node.is_folder} isSystem={node.is_system} className="h-9 w-9" />
              <span className="text-xs text-surface-on truncate w-full">{node.name}</span>
              {!node.is_folder && (
                <span className="text-xs text-surface-on-variant">{formatBytes(node.size)}</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <table className="w-full text-sm select-none" onContextMenu={handleBlankBg}>
      <thead>
        <tr className="border-b border-divider text-left text-surface-on-variant">
          <th className="py-2 px-3 font-medium">{t('drive.fileListNameCol')}</th>
          <th className="py-2 px-3 font-medium w-24">{t('drive.fileListSizeCol')}</th>
          <th className="py-2 px-3 font-medium w-28">{t('drive.fileListMtimeCol')}</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((node) => {
          const selected = selectedIds.has(node.id)
          return (
            <tr
              key={node.id}
              onClick={handleClick(node)}
              onDoubleClick={handleDoubleClick(node)}
              onContextMenu={handleRowContextMenu(node)}
              className={clsx(
                'border-b border-divider cursor-pointer transition-colors',
                selected
                  ? 'bg-primary/15'
                  : 'hover:bg-surface-variant/50',
              )}
            >
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <FileIcon mimeType={node.mime_type || ''} isFolder={node.is_folder} isSystem={node.is_system} className="h-5 w-5" />
                  <span className="truncate">{node.name}</span>
                </div>
              </td>
              <td className="py-2 px-3 text-surface-on-variant">
                {node.is_folder ? '-' : formatBytes(node.size)}
              </td>
              <td className="py-2 px-3 text-surface-on-variant">
                {formatDate(node.updated_at)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
