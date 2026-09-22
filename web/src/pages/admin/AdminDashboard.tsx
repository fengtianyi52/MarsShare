import { useQuery } from '@tanstack/react-query'
import { getDashboard } from '../../lib/api'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import {
  Users,
  FileText,
  Folder,
  HardDrive,
  Flag,
  Flame,
  Settings,
  Ticket,
  Shield,
  Crown,
  CreditCard,
  type LucideIcon,
} from '../../components/icons'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

interface StatCardProps {
  Icon: LucideIcon
  label: string
  value: string | number
  color?: string
}

function StatCard({ Icon, label, value, color = 'bg-primary/15 text-primary' }: StatCardProps) {
  return (
    <div className="bg-surface rounded shadow-elevation-1 p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded flex items-center justify-center ${color}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <p className="text-xs text-surface-on-variant">{label}</p>
          <p className="text-xl font-bold text-surface-on">{value}</p>
        </div>
      </div>
    </div>
  )
}

interface AdminSubPage {
  sub: string
  Icon: LucideIcon
  labelKey: string
}

const adminSubPages: AdminSubPage[] = [
  { sub: 'users', Icon: Users, labelKey: 'admin.menu.users' },
  { sub: 'posts', Icon: FileText, labelKey: 'admin.menu.posts' },
  { sub: 'files', Icon: Folder, labelKey: 'admin.menu.files' },
  { sub: 'topics', Icon: Flame, labelKey: 'admin.menu.topics' },
  { sub: 'reports', Icon: Flag, labelKey: 'admin.menu.reports' },
  { sub: 'hot-search', Icon: Flame, labelKey: 'admin.menu.hotSearch' },
  { sub: 'settings', Icon: Settings, labelKey: 'admin.menu.settings' },
  { sub: 'redeem', Icon: Ticket, labelKey: 'admin.menu.redeem' },
  { sub: 'storage', Icon: HardDrive, labelKey: 'admin.menu.storage' },
  { sub: 'membership', Icon: Crown, labelKey: 'admin.menu.membership' },
  { sub: 'orders', Icon: CreditCard, labelKey: 'admin.menu.orders' },
]

export default function AdminDashboardPage() {
  const t = useT()
  const { adminPath } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['adminDashboard'],
    queryFn: getDashboard,
  })

  if (isLoading) {
    return <AppShell><LoadingSpinner className="py-20" /></AppShell>
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-6">
          <Shield className="h-5 w-5" aria-hidden />
          {t('admin.dashboard.title')}
        </h1>

        {/* Stats grid */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard Icon={Users} label={t('admin.dashboard.totalUsers')} value={data.user_count} />
            <StatCard Icon={FileText} label={t('admin.dashboard.totalPosts')} value={data.post_count} />
            <StatCard Icon={Folder} label={t('admin.dashboard.totalFiles')} value={data.file_count} />
            <StatCard Icon={HardDrive} label={t('admin.dashboard.totalStorage')} value={formatBytes(data.total_storage_bytes)} />
            <StatCard
              Icon={Flag}
              label={t('admin.dashboard.pendingReports')}
              value={data.pending_reports}
              color="bg-error/15 text-error"
            />
          </div>
        )}

        {/* Quick links */}
        <h2 className="text-sm font-medium text-surface-on-variant mb-3">{t('admin.dashboard.features')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {adminSubPages.map((item) => (
            <Link
              key={item.sub}
              to={`/${adminPath}/${item.sub}`}
              className="bg-surface rounded shadow-elevation-1 p-5 flex items-center gap-3"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-primary">
                <item.Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-sm font-medium text-surface-on">{t(item.labelKey)}</span>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
