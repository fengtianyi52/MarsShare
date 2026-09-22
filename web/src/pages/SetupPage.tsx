import { useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { setupInitialize, type SetupInitializeReq } from '../lib/api'
import { useT } from '../lib/i18n'
import LoadingSpinner from '../components/LoadingSpinner'
import { PartyPopper, Check, HardDrive, Cloud, type LucideIcon } from '../components/icons'

export default function SetupPage() {
  const t = useT()
  const { markSetupDone } = useAuth()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const STEPS = [
    t('setup.step.siteInfo'),
    t('setup.step.adminAccount'),
    t('setup.step.fileStorage'),
    t('setup.step.adminSettings'),
    t('setup.step.finish'),
  ]

  const [form, setForm] = useState<SetupInitializeReq>({
    site_name: 'MarsShare',
    site_description: '',
    admin_path: 'admin',
    admin_email: '',
    admin_username: '',
    admin_password: '',
    storage_type: 'local',
    local_path: '/data/storage',
    s3_endpoint: '',
    s3_bucket: '',
    s3_region: '',
    s3_access_key: '',
    s3_secret_key: '',
  })

  const update = (patch: Partial<SetupInitializeReq>) =>
    setForm(prev => ({ ...prev, ...patch }))

  const canNext = (): boolean => {
    switch (step) {
      case 0: return form.site_name.trim().length > 0
      case 1: return form.admin_email.includes('@') && form.admin_password.length >= 6
      case 2: return form.storage_type === 'local' || (!!form.s3_endpoint && !!form.s3_bucket)
      case 3: return form.admin_path.trim().length > 0
      default: return true
    }
  }

  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)
    try {
      await setupInitialize(form)
      setDone(true)
      markSetupDone()
    } catch (e: any) {
      setError(e.message || t('setup.initFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-surface rounded shadow-elevation-8 p-8 text-center">
          <PartyPopper className="h-14 w-14 text-primary mx-auto mb-4" aria-hidden />
          <h1 className="text-2xl font-bold text-surface-on mb-2">{t('setup.initComplete')}</h1>
          <p className="text-surface-on-variant mb-6">
            {t('setup.readyMessage', { site: form.site_name })}
          </p>
          <a
            href="/login"
            className="inline-block px-8 py-3 bg-primary text-primary-on rounded font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
          >
            {t('setup.goLogin')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-surface-on mb-2">{t('setup.title', { site: 'MarsShare' })}</h1>
          <p className="text-surface-on-variant">{t('setup.subtitle')}</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    i < step
                      ? 'bg-primary text-primary-on'
                      : i === step
                        ? 'bg-primary/15 text-primary ring-2 ring-primary'
                        : 'bg-surface-variant text-surface-on-variant'
                  }`}
                >
                  {i < step ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </div>
                <span className="text-xs mt-1 text-surface-on-variant hidden sm:block max-w-[80px] text-center">
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-8 sm:w-12 h-0.5 mx-1 ${i < step ? 'bg-primary' : 'bg-divider'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-surface rounded shadow-elevation-2 p-6 sm:p-8">
          {error && (
            <div className="mb-4 p-3 bg-error-container text-error-on-container rounded text-sm">
              {error}
            </div>
          )}

          {/* Step 0: Site Info */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-xl font-medium text-surface-on">{t('setup.siteInfo.title')}</h2>
              <p className="text-sm text-surface-on-variant">{t('setup.siteInfo.desc')}</p>
              <Field label={t('setup.siteInfo.siteName')} required>
                <input
                  type="text"
                  value={form.site_name}
                  onChange={e => update({ site_name: e.target.value })}
                  placeholder="MarsShare"
                  className="input-field"
                />
              </Field>
              <Field label={t('setup.siteInfo.siteDesc')}>
                <textarea
                  value={form.site_description}
                  onChange={e => update({ site_description: e.target.value })}
                  placeholder={t('setup.siteInfo.siteDescPlaceholder')}
                  rows={3}
                  className="input-field resize-none"
                />
              </Field>
            </div>
          )}

          {/* Step 1: Admin Account */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-medium text-surface-on">{t('setup.admin.title')}</h2>
              <p className="text-sm text-surface-on-variant">{t('setup.admin.desc')}</p>
              <Field label={t('setup.admin.email')} required>
                <input
                  type="email"
                  value={form.admin_email}
                  onChange={e => update({ admin_email: e.target.value })}
                  placeholder="admin@example.com"
                  className="input-field"
                />
              </Field>
              <Field label={t('setup.admin.username')}>
                <input
                  type="text"
                  value={form.admin_username}
                  onChange={e => update({ admin_username: e.target.value })}
                  placeholder={t('setup.admin.usernameAuto')}
                  className="input-field"
                />
              </Field>
              <Field label={t('setup.admin.password')} required>
                <input
                  type="password"
                  value={form.admin_password}
                  onChange={e => update({ admin_password: e.target.value })}
                  placeholder={t('setup.admin.passwordHint')}
                  className="input-field"
                />
              </Field>
            </div>
          )}

          {/* Step 2: File Storage */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-medium text-surface-on">{t('setup.storage.title')}</h2>
              <p className="text-sm text-surface-on-variant">{t('setup.storage.desc')}</p>

              <div className="flex gap-3">
                <StorageOption
                  active={form.storage_type === 'local'}
                  onClick={() => update({ storage_type: 'local' })}
                  Icon={HardDrive}
                  title={t('setup.storage.local')}
                  desc={t('setup.storage.localDesc')}
                />
                <StorageOption
                  active={form.storage_type === 's3'}
                  onClick={() => update({ storage_type: 's3' })}
                  Icon={Cloud}
                  title={t('setup.storage.s3')}
                  desc={t('setup.storage.s3Desc')}
                />
              </div>

              {form.storage_type === 'local' && (
                <Field label={t('setup.storage.path')}>
                  <input
                    type="text"
                    value={form.local_path}
                    onChange={e => update({ local_path: e.target.value })}
                    placeholder="/data/storage"
                    className="input-field"
                  />
                </Field>
              )}

              {form.storage_type === 's3' && (
                <div className="space-y-4">
                  <Field label="Endpoint URL" required>
                    <input
                      type="text"
                      value={form.s3_endpoint}
                      onChange={e => update({ s3_endpoint: e.target.value })}
                      placeholder="https://s3.amazonaws.com"
                      className="input-field"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Bucket" required>
                      <input
                        type="text"
                        value={form.s3_bucket}
                        onChange={e => update({ s3_bucket: e.target.value })}
                        className="input-field"
                      />
                    </Field>
                    <Field label="Region">
                      <input
                        type="text"
                        value={form.s3_region}
                        onChange={e => update({ s3_region: e.target.value })}
                        placeholder="auto"
                        className="input-field"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Access Key">
                      <input
                        type="text"
                        value={form.s3_access_key}
                        onChange={e => update({ s3_access_key: e.target.value })}
                        className="input-field"
                      />
                    </Field>
                    <Field label="Secret Key">
                      <input
                        type="password"
                        value={form.s3_secret_key}
                        onChange={e => update({ s3_secret_key: e.target.value })}
                        className="input-field"
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Admin Panel Route */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-medium text-surface-on">{t('setup.adminPanel.title')}</h2>
              <p className="text-sm text-surface-on-variant">
                {t('setup.adminPanel.desc')}
              </p>
              <Field label={t('setup.adminPanel.path')} required>
                <div className="flex items-center gap-2">
                  <span className="text-surface-on-variant shrink-0">/{''}</span>
                  <input
                    type="text"
                    value={form.admin_path}
                    onChange={e => update({ admin_path: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                    placeholder="admin"
                    className="input-field"
                  />
                </div>
              </Field>
              <div className="p-3 bg-primary/10 rounded text-sm text-primary">
                {t('setup.adminPanel.pathInfo', { path: form.admin_path || 'admin' })}
              </div>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-xl font-medium text-surface-on">{t('setup.confirm.title')}</h2>
              <p className="text-sm text-surface-on-variant">{t('setup.confirm.desc')}</p>
              <div className="space-y-3 text-sm">
                <SummaryRow label={t('setup.summary.siteName')} value={form.site_name} />
                <SummaryRow label={t('setup.summary.siteDesc')} value={form.site_description || t('common.unset')} />
                <SummaryRow label={t('setup.summary.adminEmail')} value={form.admin_email} />
                <SummaryRow label={t('setup.summary.adminUsername')} value={form.admin_username || t('setup.summary.autoGenerated')} />
                <SummaryRow label={t('setup.summary.storageType')} value={form.storage_type === 'local' ? t('setup.summary.localStorage', { path: form.local_path || '' }) : t('setup.summary.s3Storage', { endpoint: form.s3_endpoint || '' })} />
                <SummaryRow label={t('setup.summary.adminPath')} value={`/${form.admin_path}`} />
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-divider">
            <button
              onClick={() => { setStep(s => s - 1); setError('') }}
              disabled={step === 0}
              className="px-6 py-2.5 rounded text-primary font-medium uppercase tracking-wider disabled:opacity-30 hover:bg-primary/10 transition-colors"
            >
              {t('common.prev')}
            </button>

            {step < STEPS.length - 1 ? (
              <button
                onClick={() => { setStep(s => s + 1); setError('') }}
                disabled={!canNext()}
                className="px-6 py-2.5 bg-primary text-primary-on rounded font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {t('common.next')}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-8 py-2.5 bg-primary text-primary-on rounded font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
              >
                {submitting && <LoadingSpinner className="w-4 h-4" />}
                {t('setup.start')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ── */

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-surface-on">
        {label} {required && <span className="text-error">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

function StorageOption({ active, onClick, Icon, title, desc }: {
  active: boolean; onClick: () => void; Icon: LucideIcon; title: string; desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 p-4 rounded border-2 text-left transition-colors ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-divider hover:border-outline hover:bg-surface-variant/40'
      }`}
    >
      <Icon className={`h-6 w-6 mb-2 ${active ? 'text-primary' : 'text-surface-on-variant'}`} aria-hidden />
      <div className="font-medium text-surface-on text-sm">{title}</div>
      <div className="text-xs text-surface-on-variant mt-0.5">{desc}</div>
    </button>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-divider">
      <span className="text-surface-on-variant">{label}</span>
      <span className="text-surface-on font-medium">{value}</span>
    </div>
  )
}
