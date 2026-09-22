import { useQuery } from '@tanstack/react-query'
import { getPlans } from '../lib/api'
import AppShell from '../components/layout/AppShell'
import LoadingSpinner from '../components/LoadingSpinner'
import { Crown, Check, Mail } from '../components/icons'
import { useT } from '../lib/i18n'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${bytes} B`
}

function durationLabel(days: number, t: ReturnType<typeof useT>): string {
  if (days >= 365) return t('about.perYear')
  if (days >= 90) return t('about.perQuarter')
  return t('about.perMonth')
}

export default function AboutPage() {
  const t = useT()

  const { data: plans, isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: getPlans,
  })

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/15 text-primary mb-4">
            <Crown className="h-8 w-8" aria-hidden />
          </div>
          <h1 className="text-3xl font-bold text-surface-on">{t('about.heroTitle')}</h1>
          <p className="text-base text-surface-on-variant mt-2 max-w-lg mx-auto">
            {t('about.heroDesc')}
          </p>
        </div>

        {/* Plans */}
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : plans && plans.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="bg-surface rounded-2xl shadow-elevation-1 p-6 flex flex-col border border-outline-variant hover:shadow-elevation-2 transition-shadow"
              >
                <h3 className="text-lg font-bold text-surface-on">{plan.name}</h3>
                <div className="mt-3 mb-1">
                  <span className="text-3xl font-extrabold text-primary">
                    ¥{plan.price.toFixed(0)}
                  </span>
                  <span className="text-sm text-surface-on-variant ml-1">
                    / {durationLabel(plan.duration_days, t)}
                  </span>
                </div>
                <ul className="mt-4 space-y-2 flex-1">
                  <li className="flex items-center gap-2 text-sm text-surface-on">
                    <Check className="h-4 w-4 text-primary shrink-0" aria-hidden />
                    {t('about.featureStorage', { size: formatBytes(plan.storage_limit) })}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-surface-on">
                    <Check className="h-4 w-4 text-primary shrink-0" aria-hidden />
                    {t('about.featureUpload', { size: formatBytes(plan.upload_limit) })}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-surface-on">
                    <Check className="h-4 w-4 text-primary shrink-0" aria-hidden />
                    {t('about.featureStack')}
                  </li>
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        {/* Info sections */}
        <div className="space-y-8 text-sm text-surface-on-variant leading-relaxed">
          <Section title={t('about.deliveryTitle')}>
            <p>{t('about.deliveryContent')}</p>
          </Section>
          <Section title={t('about.cancelTitle')}>
            <p>{t('about.cancelContent')}</p>
          </Section>
          <Section title={t('about.refundTitle')}>
            <p>{t('about.refundContent')}</p>
          </Section>
          <Section title={t('about.contactTitle')}>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary shrink-0" aria-hidden />
              <a
                href="mailto:support@seimo.cn"
                className="text-primary hover:underline"
              >
                support@seimo.cn
              </a>
            </div>
          </Section>
        </div>
      </div>
    </AppShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl shadow-elevation-1 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant">
        <h2 className="text-base font-semibold text-surface-on">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}
