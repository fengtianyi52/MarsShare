import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  copyNode,
  createFolder,
  deleteNode,
  downloadObjectFile,
  getDriveTree,
  moveNode,
  renameNode,
} from '../lib/api'
import DriveTrashPanel from '../components/DriveTrashPanel'
import type { DriveNode } from '../types'
import AppShell from '../components/layout/AppShell'
import DriveTree from '../components/DriveTree'
import FileList from '../components/FileList'
import UploadModal from '../components/UploadModal'
import FilePreview from '../components/FilePreview'
import ShareDialog from '../components/ShareDialog'
import LoadingSpinner from '../components/LoadingSpinner'
import ContextMenu, { type ContextMenuItems } from '../components/ContextMenu'
import FolderPickerDialog, { collectDescendants } from '../components/FolderPickerDialog'
import {
  Folder,
  Upload,
  LayoutGrid,
  List,
  Download,
  LinkIcon,
  Pencil,
  Trash2,
  Copy,
  FolderInput,
  Eye,
  X,
} from '../components/icons'
import { useT } from '../lib/i18n'
import { useToast, useConfirm } from '../lib/notify'

function findNode(nodes: DriveNode[], id: string): DriveNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children, id)
    if (child) return child
  }
  return null
}

// Flatten visible nodes for shift-range selection.
function visibleOrderIds(nodes: DriveNode[]): string[] {
  return nodes.map((n) => n.id)
}

// True when the node is system-protected: either the system folder itself,
// or any node nested inside one. The drive tree on the client knows about
// the parent chain, so we walk it from the candidate up to the root and
// check is_system on every ancestor.
function isProtectedNode(roots: DriveNode[], node: DriveNode): boolean {
  if (node.is_system) return true
  if (!node.parent_id) return false
  // Build a quick id→node lookup once and walk up the parent chain.
  const lookup = new Map<string, DriveNode>()
  const collect = (ns: DriveNode[]) => {
    for (const n of ns) {
      lookup.set(n.id, n)
      if (n.children?.length) collect(n.children)
    }
  }
  collect(roots)
  let cur: DriveNode | undefined = node
  while (cur?.parent_id) {
    const parent = lookup.get(cur.parent_id)
    if (!parent) return false
    if (parent.is_system) return true
    cur = parent
  }
  return false
}

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

type ContextMenuState =
  | { kind: 'node'; x: number; y: number; targets: DriveNode[] }
  | { kind: 'blank'; x: number; y: number }
  | null

type FolderOp = {
  mode: 'move' | 'copy'
  targets: DriveNode[]
}

// ────────────────────────────────────────────────────────────

export default function DrivePage() {
  const t = useT()
  const { showToast } = useToast()
  const { showConfirm } = useConfirm()
  const qc = useQueryClient()
  // viewMode toggles the right pane between the file browser ('files')
  // and the recycle-bin panel ('trash'). The sidebar stays mounted in
  // both modes — clicking the 回收站 entry only swaps the right pane.
  // We seed the initial mode from the URL so a direct visit to
  // /drive/trash still opens the trash; subsequent toggles never touch
  // the URL so folder-navigation state survives the switch.
  const initialPathname = useLocation().pathname
  const [viewMode, setViewMode] = useState<'files' | 'trash'>(
    initialPathname === '/drive/trash' ? 'trash' : 'files',
  )
  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [previewNode, setPreviewNode] = useState<DriveNode | null>(null)
  const [shareNode, setShareNode] = useState<DriveNode | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)

  // Context menu
  const [menu, setMenu] = useState<ContextMenuState>(null)

  // Rename dialog (inline minimalist)
  const [renameTarget, setRenameTarget] = useState<DriveNode | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Folder picker dialog (move/copy)
  const [folderOp, setFolderOp] = useState<FolderOp | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['driveTree'],
    queryFn: getDriveTree,
  })

  const roots = data?.items ?? []
  const currentNode = currentFolder ? findNode(roots, currentFolder) : null
  const visibleNodes = currentNode ? currentNode.children : roots
  // Block uploads / new folders / paste-style mutations when the user is
  // browsing inside the system-protected "帖子图片" folder.
  const currentIsProtected = currentNode ? isProtectedNode(roots, currentNode) : false

  // Clear selection whenever the current folder changes.
  useEffect(() => {
    setSelectedIds(new Set())
    setLastClickedId(null)
  }, [currentFolder])

  // Drop selections that no longer exist (after delete/move).
  useEffect(() => {
    setSelectedIds((prev) => {
      const visibleIds = new Set(visibleNodes.map((n) => n.id))
      const next = new Set<string>()
      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [visibleNodes])

  // ── Mutations ──────────────────────────────────────────

  const refreshDrive = () => {
    qc.invalidateQueries({ queryKey: ['driveTree'] })
    qc.invalidateQueries({ queryKey: ['driveTrash'] })
  }

  const createFolderMut = useMutation({
    mutationFn: () => createFolder({ parent_id: currentFolder, name: newFolderName }),
    onSuccess: () => {
      setNewFolderName('')
      setShowNewFolder(false)
      refreshDrive()
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await deleteNode(id)
      }
    },
    onSuccess: () => {
      setSelectedIds(new Set())
      refreshDrive()
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameNode(id, name),
    onSuccess: () => {
      setRenameTarget(null)
      refreshDrive()
    },
  })

  const moveMut = useMutation({
    mutationFn: async ({ ids, parentId }: { ids: string[]; parentId: string | null }) => {
      for (const id of ids) {
        await moveNode(id, parentId)
      }
    },
    onSuccess: () => {
      setFolderOp(null)
      setSelectedIds(new Set())
      refreshDrive()
    },
  })

  const copyMut = useMutation({
    mutationFn: async ({ ids, parentId }: { ids: string[]; parentId: string | null }) => {
      for (const id of ids) {
        await copyNode(id, parentId)
      }
    },
    onSuccess: () => {
      setFolderOp(null)
      refreshDrive()
    },
  })

  // ── Helpers ────────────────────────────────────────────

  const breadcrumbs = useMemo(() => {
    const trail = [{ id: null as string | null, name: t('drive.myDrive') }]
    if (!currentFolder) return trail

    const build = (nodes: DriveNode[], targetId: string, path: { id: string | null; name: string }[]): boolean => {
      for (const node of nodes) {
        const next = [...path, { id: node.id, name: node.name }]
        if (node.id === targetId) {
          trail.push(...next)
          return true
        }
        if (build(node.children, targetId, next)) {
          return true
        }
      }
      return false
    }

    build(roots, currentFolder, [])
    return trail
  }, [currentFolder, roots, t])

  const selectedNodes = useMemo(
    () => visibleNodes.filter((n) => selectedIds.has(n.id)),
    [visibleNodes, selectedIds],
  )

  const handleOpen = (node: DriveNode) => {
    if (node.is_folder) {
      setCurrentFolder(node.id)
      return
    }
    setPreviewNode(node)
  }

  const handleSelect = (node: DriveNode, mods: { ctrl: boolean; shift: boolean }) => {
    setSelectedIds((prev) => {
      // Shift+Click: range select between last clicked and current.
      if (mods.shift && lastClickedId) {
        const order = visibleOrderIds(visibleNodes)
        const a = order.indexOf(lastClickedId)
        const b = order.indexOf(node.id)
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a]
          const next = new Set(prev)
          for (let i = from; i <= to; i++) next.add(order[i])
          return next
        }
      }
      // Ctrl/Cmd+Click: toggle.
      if (mods.ctrl) {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      }
      // Plain click: replace selection.
      return new Set([node.id])
    })
    setLastClickedId(node.id)
  }

  const handleContextMenu = (node: DriveNode, e: MouseEvent) => {
    // If right-clicking on a node that isn't currently selected, replace selection
    // with just that node so the menu acts on what the user clicked.
    let targets: DriveNode[]
    if (selectedIds.has(node.id) && selectedIds.size > 1) {
      targets = selectedNodes
    } else {
      targets = [node]
      setSelectedIds(new Set([node.id]))
      setLastClickedId(node.id)
    }
    setMenu({ kind: 'node', x: e.clientX, y: e.clientY, targets })
  }

  const handleBlankContextMenu = (e: MouseEvent) => {
    setSelectedIds(new Set())
    setMenu({ kind: 'blank', x: e.clientX, y: e.clientY })
  }

  const startRename = (node: DriveNode) => {
    setRenameTarget(node)
    setRenameValue(node.name)
  }

  const startMove = (targets: DriveNode[]) => {
    setFolderOp({ mode: 'move', targets })
  }

  const startCopy = (targets: DriveNode[]) => {
    setFolderOp({ mode: 'copy', targets })
  }

  const confirmDelete = async (targets: DriveNode[]) => {
    if (targets.length === 0) return
    const msg = targets.length === 1
      ? t('drive.confirmDeleteOne', { name: targets[0].name })
      : t('drive.confirmDeleteMany', { count: targets.length })
    const ok = await showConfirm({ message: msg, danger: true })
    if (ok) deleteMut.mutate(targets.map((tn) => tn.id))
  }

  const handleDownload = async (node: DriveNode) => {
    if (node.is_folder || !node.object_id) return
    try {
      await downloadObjectFile(node.object_id, node.name)
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || t('common.downloadFailed') })
    }
  }

  // ── Context menu items ─────────────────────────────────

  const buildNodeMenuItems = (targets: DriveNode[]): ContextMenuItems => {
    const single = targets.length === 1
    const onlyFile = targets.every((tn) => !tn.is_folder)
    // The mutating actions (rename, move, copy, share, delete) are hidden
    // entirely whenever any selected target is system-protected. Allowing
    // them through the UI would just produce a 403 from the backend.
    const anyProtected = targets.some((tn) => isProtectedNode(roots, tn))
    const items: ContextMenuItems = []

    if (single) {
      const tn = targets[0]
      items.push({
        key: 'open',
        label: tn.is_folder ? t('common.openFolder') : t('common.preview'),
        icon: tn.is_folder ? <Folder className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
        onClick: () => handleOpen(tn),
      })
    }

    if (onlyFile && single) {
      items.push({
        key: 'download',
        label: t('common.download'),
        icon: <Download className="h-4 w-4" />,
        onClick: () => handleDownload(targets[0]),
      })
      if (!anyProtected) {
        items.push({
          key: 'share',
          label: t('common.share'),
          icon: <LinkIcon className="h-4 w-4" />,
          onClick: () => setShareNode(targets[0]),
        })
      }
    }

    if (anyProtected) {
      // System folder / system-folder children only get "open" / "preview"
      // (and download for files). Stop here so the destructive actions
      // aren't even rendered.
      return items
    }

    if (items.length > 0) items.push('divider')

    if (single) {
      items.push({
        key: 'rename',
        label: t('common.rename'),
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => startRename(targets[0]),
      })
    }
    items.push({
      key: 'move',
      label: single ? t('common.moveTo') : t('drive.moveN', { count: targets.length }),
      icon: <FolderInput className="h-4 w-4" />,
      onClick: () => startMove(targets),
    })
    items.push({
      key: 'copy',
      label: single ? t('common.copyTo') : t('drive.copyN', { count: targets.length }),
      icon: <Copy className="h-4 w-4" />,
      onClick: () => startCopy(targets),
    })

    items.push('divider')
    items.push({
      key: 'delete',
      label: single ? t('common.delete') : t('drive.deleteN', { count: targets.length }),
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onClick: () => confirmDelete(targets),
    })

    return items
  }

  const buildBlankMenuItems = (): ContextMenuItems => {
    if (currentIsProtected) {
      // System folders accept no manual writes from the right-click menu.
      return []
    }
    return [
      {
        key: 'upload',
        label: t('common.upload'),
        icon: <Upload className="h-4 w-4" />,
        onClick: () => setUploadOpen(true),
      },
      {
        key: 'newfolder',
        label: t('drive.newFolder'),
        icon: <Folder className="h-4 w-4" />,
        onClick: () => setShowNewFolder(true),
      },
    ]
  }

  // Disabled folder ids for the picker (used in move): the targets themselves
  // and (if folder) all their descendants. We also disable any system folder
  // (and its descendants) because nothing can be moved/copied into the
  // protected "帖子图片" folder.
  const pickerDisabledIds = useMemo(() => {
    const disabled = new Set<string>()
    // Always block system-protected folders as targets.
    const blockSystem = (nodes: DriveNode[]) => {
      for (const n of nodes) {
        if (n.is_system) collectDescendants(n, disabled)
        if (n.children?.length) blockSystem(n.children)
      }
    }
    blockSystem(roots)

    if (!folderOp) return disabled
    if (folderOp.mode === 'move') {
      for (const t of folderOp.targets) {
        if (t.is_folder) collectDescendants(t, disabled)
        else disabled.add(t.id)
      }
    } else {
      // copy: prevent copying a folder into itself / its descendants
      for (const t of folderOp.targets) {
        if (t.is_folder) collectDescendants(t, disabled)
      }
    }
    return disabled
  }, [folderOp, roots])

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-4rem)]">
        <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-divider bg-surface p-3 overflow-y-auto scrollbar-thin">
          <h3 className="px-2 mb-2 text-xs font-medium text-surface-on-variant uppercase tracking-wider">
            {t('drive.folder')}
          </h3>
          <DriveTree
            nodes={roots.filter((node) => node.is_folder)}
            selectedId={viewMode === 'files' ? currentFolder : null}
            onSelect={(node) => {
              setViewMode('files')
              setCurrentFolder(node.id === 'root' ? null : node.id)
            }}
          />
          <div className="mt-auto pt-3 border-t border-divider">
            <button
              type="button"
              onClick={() => setViewMode('trash')}
              className={
                'flex w-full items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors ' +
                (viewMode === 'trash'
                  ? 'bg-primary/10 text-primary'
                  : 'text-surface-on-variant hover:bg-surface-variant hover:text-primary')
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              <span>{t('drive.trashTitle')}</span>
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
        {viewMode === 'trash' ? (
          <DriveTrashPanel />
        ) : (
          <>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-divider">
            <div className="flex items-center gap-1 text-sm flex-1 min-w-0 overflow-x-auto">
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.id ?? 'root'}-${index}`} className="flex items-center shrink-0">
                  {index > 0 && <span className="mx-1 text-surface-on-variant">/</span>}
                  <button
                    onClick={() => setCurrentFolder(crumb.id)}
                    className="text-surface-on-variant hover:text-primary"
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowNewFolder(true)}
                disabled={currentIsProtected}
                title={currentIsProtected ? t('drive.newFolderDisabled') : undefined}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-variant rounded hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-variant disabled:hover:text-surface-on-variant"
              >
                <Folder className="h-3.5 w-3.5" aria-hidden />
                {t('drive.newFolder')}
              </button>
              <button
                onClick={() => setUploadOpen(true)}
                disabled={currentIsProtected}
                title={currentIsProtected ? t('drive.uploadDisabled') : undefined}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-on rounded shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                {t('common.upload')}
              </button>
              <button
                onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                aria-label={view === 'grid' ? t('drive.viewList') : t('drive.viewGrid')}
                className="p-1.5 rounded hover:bg-surface-variant text-surface-on-variant transition-colors"
              >
                {view === 'grid' ? <List className="h-4 w-4" aria-hidden /> : <LayoutGrid className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </div>

          {showNewFolder && (
            <div className="flex items-center gap-2 px-4 py-2 bg-surface-variant/40 border-b border-divider">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t('drive.folderName')}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFolderName.trim()) createFolderMut.mutate()
                  if (e.key === 'Escape') setShowNewFolder(false)
                }}
                className="flex-1 bg-surface rounded px-3 py-1.5 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
              <button
                onClick={() => createFolderMut.mutate()}
                disabled={!newFolderName.trim() || createFolderMut.isPending}
                className="px-3 py-1.5 text-xs bg-primary text-primary-on rounded shadow-elevation-1 hover:shadow-elevation-2 disabled:opacity-50 disabled:shadow-none transition-all"
              >
                {t('common.create')}
              </button>
              <button
                onClick={() => setShowNewFolder(false)}
                className="px-3 py-1.5 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}

          {/* Selection toolbar */}
          {selectedIds.size > 0 && (() => {
            // Hide all mutating actions whenever any selected node is system-
            // protected (the system folder itself or anything inside it).
            const anySelectedProtected = selectedNodes.some((n) => isProtectedNode(roots, n))
            return (
              <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border-b border-divider">
                <span className="text-xs text-primary font-medium">
                  {t('drive.selected', { count: selectedIds.size })}
                </span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="p-1 text-primary hover:bg-primary/10 rounded"
                  aria-label={t('drive.clearSelection')}
                  title={t('drive.clearSelection')}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
                <div className="flex-1" />
                {selectedNodes.length === 1 && !selectedNodes[0].is_folder && (
                  <>
                    <button
                      onClick={() => handleDownload(selectedNodes[0])}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      {t('common.download')}
                    </button>
                    {!anySelectedProtected && (
                      <button
                        onClick={() => setShareNode(selectedNodes[0])}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                      >
                        <LinkIcon className="h-3.5 w-3.5" aria-hidden />
                        {t('common.share')}
                      </button>
                    )}
                  </>
                )}
                {!anySelectedProtected && selectedNodes.length === 1 && (
                  <button
                    onClick={() => startRename(selectedNodes[0])}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {t('common.rename')}
                  </button>
                )}
                {!anySelectedProtected && (
                  <>
                    <button
                      onClick={() => startMove(selectedNodes)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                    >
                      <FolderInput className="h-3.5 w-3.5" aria-hidden />
                      {t('common.move')}
                    </button>
                    <button
                      onClick={() => startCopy(selectedNodes)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                      {t('common.copy')}
                    </button>
                    <button
                      onClick={() => confirmDelete(selectedNodes)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-error/10 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {t('common.delete')}
                    </button>
                  </>
                )}
                {anySelectedProtected && (
                  <span className="text-[11px] text-surface-on-variant/80">
                    {t('drive.systemFolderHint')}
                  </span>
                )}
              </div>
            )
          })()}

          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <LoadingSpinner className="py-12" />
            ) : (
              <FileList
                nodes={visibleNodes}
                view={view}
                selectedIds={selectedIds}
                onOpen={handleOpen}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
                onBlankContextMenu={handleBlankContextMenu}
              />
            )}
          </div>
          </>
        )}
        </div>
      </div>

      {/* Context menu */}
      {menu && menu.kind === 'node' && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildNodeMenuItems(menu.targets)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && menu.kind === 'blank' && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildBlankMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}

      {/* Rename dialog */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-sm mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-medium text-surface-on mb-3">{t('drive.renameDialogTitle')}</h2>
            <input
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  renameMut.mutate({ id: renameTarget.id, name: renameValue.trim() })
                }
                if (e.key === 'Escape') setRenameTarget(null)
              }}
              className="w-full bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRenameTarget(null)}
                className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => renameMut.mutate({ id: renameTarget.id, name: renameValue.trim() })}
                disabled={!renameValue.trim() || renameMut.isPending}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 disabled:opacity-50 disabled:shadow-none"
              >
                {renameMut.isPending ? t('common.saving') : t('common.save')}
              </button>
            </div>
            {renameMut.isError && (
              <p className="text-xs text-error mt-2">{(renameMut.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {/* Folder picker for move/copy */}
      {folderOp && (
        <FolderPickerDialog
          open
          title={folderOp.mode === 'move' ? t('drive.moveDialogTitle') : t('drive.copyDialogTitle')}
          confirmLabel={folderOp.mode === 'move' ? t('common.move') : t('common.copy')}
          roots={roots}
          disabledIds={pickerDisabledIds}
          defaultSelectedId={currentFolder}
          onClose={() => setFolderOp(null)}
          onConfirm={(parentId) => {
            const ids = folderOp.targets.map((tn) => tn.id)
            if (folderOp.mode === 'move') {
              moveMut.mutate({ ids, parentId })
            } else {
              copyMut.mutate({ ids, parentId })
            }
          }}
        />
      )}

      <UploadModal parentId={currentFolder} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      {previewNode && <FilePreview node={previewNode} onClose={() => setPreviewNode(null)} />}
      {shareNode && <ShareDialog node={shareNode} open={Boolean(shareNode)} onClose={() => setShareNode(null)} />}
    </AppShell>
  )
}
