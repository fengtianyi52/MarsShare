import { useState } from 'react'
import type { DriveNode } from '../types'
import { Folder, Home, ChevronRight, Lock, Image as ImageIcon } from './icons'
import clsx from 'clsx'
import { useT } from '../lib/i18n'

interface Props {
  nodes: DriveNode[]
  selectedId: string | null
  onSelect: (node: DriveNode) => void
}

function TreeNode({ node, selectedId, onSelect, depth }: {
  node: DriveNode
  selectedId: string | null
  onSelect: (node: DriveNode) => void
  depth: number
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const isSelected = selectedId === node.id
  const hasChildFolder = node.children.some((child) => child.is_folder)

  if (!node.is_folder) return null

  return (
    <div>
      <button
        onClick={() => {
          onSelect(node)
          setExpanded((value) => !value)
        }}
        title={node.is_system ? t('drive.systemFolderLock') : undefined}
        className={clsx(
          'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left transition-colors',
          isSelected
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-surface-on hover:bg-surface-variant',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <ChevronRight
          className={clsx(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            hasChildFolder ? 'opacity-100' : 'opacity-0',
            expanded && 'rotate-90',
          )}
          aria-hidden
        />
        {node.is_system ? (
          <ImageIcon className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        )}
        <span className="truncate">{node.name}</span>
        {node.is_system && (
          <Lock className="h-3 w-3 shrink-0 text-surface-on-variant/70" aria-hidden />
        )}
      </button>
      {expanded && node.children.length > 0 && (
        <div>
          {node.children
            .filter((child) => child.is_folder)
            .map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                selectedId={selectedId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  )
}

export default function DriveTree({ nodes, selectedId, onSelect }: Props) {
  const t = useT()
  return (
    <div className="space-y-0.5">
      <button
        onClick={() => onSelect({
          id: 'root',
          parent_id: null,
          name: t('drive.myDrive'),
          is_folder: true,
          object_id: null,
          size: 0,
          mime_type: '',
          children: [],
          is_trashed: false,
          trashed_at: null,
          created_at: '',
          updated_at: '',
        })}
        className={clsx(
          'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors',
          selectedId === null || selectedId === 'root'
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-surface-on hover:bg-surface-variant',
        )}
      >
        <Home className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t('drive.myDrive')}</span>
      </button>
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} depth={1} />
      ))}
    </div>
  )
}
