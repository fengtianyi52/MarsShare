import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { DriveNode } from '../types'
import { Folder, Home, ChevronRight, X } from './icons'
import { useT } from '../lib/i18n'

interface Props {
  open: boolean
  title: string
  confirmLabel?: string
  // Source tree (top-level nodes from the drive). The dialog only shows folders.
  roots: DriveNode[]
  // Folder ids that should be disabled (e.g. the source itself + its descendants
  // when moving, to prevent moving a folder into itself).
  disabledIds?: Set<string>
  // Default selection. null means root.
  defaultSelectedId?: string | null
  onClose: () => void
  onConfirm: (parentId: string | null) => void
}

// Recursively collects every descendant id of the given node into the set.
export function collectDescendants(node: DriveNode, into: Set<string>) {
  into.add(node.id)
  for (const child of node.children) {
    if (child.is_folder) collectDescendants(child, into)
  }
}

interface RowProps {
  node: DriveNode
  depth: number
  selectedId: string | null
  disabledIds: Set<string>
  onSelect: (id: string) => void
}

function Row({ node, depth, selectedId, disabledIds, onSelect }: RowProps) {
  const t = useT()
  const [expanded, setExpanded] = useState(depth < 1)
  if (!node.is_folder) return null
  const childFolders = node.children.filter((c) => c.is_folder)
  const hasChildFolder = childFolders.length > 0
  const isSelected = selectedId === node.id
  const disabled = disabledIds.has(node.id)

  return (
    <div>
      <div
        className={clsx(
          'flex items-center gap-1 rounded text-sm',
          isSelected && !disabled && 'bg-primary/10 text-primary font-medium',
          !isSelected && !disabled && 'text-surface-on hover:bg-surface-variant',
          disabled && 'text-surface-on-variant opacity-50',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
          className={clsx(
            'p-1 rounded shrink-0',
            !hasChildFolder && 'invisible',
          )}
        >
          <ChevronRight className={clsx('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(node.id)}
          className={clsx(
            'flex-1 flex items-center gap-2 py-1.5 pr-2 text-left',
            disabled && 'cursor-not-allowed',
          )}
        >
          <Folder className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {expanded && hasChildFolder && (
        <div>
          {childFolders.map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              disabledIds={disabledIds}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderPickerDialog({
  open,
  title,
  confirmLabel,
  roots,
  disabledIds,
  defaultSelectedId = null,
  onClose,
  onConfirm,
}: Props) {
  const t = useT()
  const [selectedId, setSelectedId] = useState<string | null>(defaultSelectedId)
  const disabled = useMemo(() => disabledIds ?? new Set<string>(), [disabledIds])
  const folderRoots = roots.filter((n) => n.is_folder)
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirmOk')

  // Reset selection whenever the dialog reopens with a new default.
  // Using a key ensures internal state is fresh on each open.
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
              <h2 className="text-base font-medium text-surface-on">{title}</h2>
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="p-1 text-surface-on-variant hover:text-error rounded"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
              {/* Root option */}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className={clsx(
                  'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left transition-colors',
                  selectedId === null
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-surface-on hover:bg-surface-variant',
                )}
              >
                <Home className="h-4 w-4 shrink-0" aria-hidden />
                <span>{t('drive.myDriveRoot')}</span>
              </button>

              {folderRoots.length > 0 ? (
                <div className="mt-1">
                  {folderRoots.map((node) => (
                    <Row
                      key={node.id}
                      node={node}
                      depth={0}
                      selectedId={selectedId}
                      disabledIds={disabled}
                      onSelect={setSelectedId}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-surface-on-variant px-2 py-3">{t('drive.noOtherFolders')}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-divider">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (selectedId !== null && disabled.has(selectedId)) return
                  onConfirm(selectedId)
                }}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
              >
                {resolvedConfirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
