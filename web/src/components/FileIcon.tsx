import {
  Folder,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  FileArchive,
  FileIcon as GenericFile,
  type LucideIcon,
} from './icons'

interface Props {
  mimeType: string
  isFolder?: boolean
  // System-managed folder (currently the per-user "帖子图片" folder).
  // Rendered with a distinctive image icon so users immediately spot it.
  isSystem?: boolean
  className?: string
}

function pickIcon(mimeType: string, isFolder?: boolean, isSystem?: boolean): LucideIcon {
  if (isFolder) {
    // System folder = post images. Use the picture icon to telegraph what
    // it holds even before the user opens it.
    return isSystem ? ImageIcon : Folder
  }
  if (mimeType.startsWith('image/')) return ImageIcon
  if (mimeType.startsWith('video/')) return Film
  if (mimeType.startsWith('audio/')) return Music
  if (mimeType === 'application/pdf') return FileText
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gzip'))
    return FileArchive
  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('javascript')
  )
    return FileText
  return GenericFile
}

export default function FileIcon({ mimeType, isFolder, isSystem, className = 'h-6 w-6' }: Props) {
  const Icon = pickIcon(mimeType, isFolder, isSystem)
  const colorClass = isFolder
    ? isSystem
      ? 'text-secondary'
      : 'text-primary'
    : mimeType.startsWith('image/')
    ? 'text-secondary'
    : mimeType.startsWith('video/')
    ? 'text-error'
    : mimeType.startsWith('audio/')
    ? 'text-warning'
    : 'text-surface-on-variant'
  return <Icon className={`${colorClass} ${className}`} aria-hidden />
}
