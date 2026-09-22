import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, upsertSetting } from '../../lib/api'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Settings } from '../../components/icons'
import { useT } from '../../lib/i18n'

// ─── Setting key constants (mirrors backend) ──────────────────────────────────
const K = {
  siteName:            'site_name',
  siteDesc:            'site_description',
  adminPath:           'admin_path',
  appBaseURL:          'app_base_url',
  storageQuota:        'default_storage_quota_bytes',
  uploadLimit:         'default_upload_limit_bytes',
  emailApiKey:         'email_resend_api_key',
  emailFrom:           'email_from',
  emailSenderName:     'email_sender_name',
  emailVerifyEnabled:  'email_verify_enabled',
  emailResetEnabled:   'email_reset_enabled',
  emailVerifySubject:  'email_verify_subject',
  emailVerifyTemplate: 'email_verify_template',
  emailResetSubject:   'email_reset_subject',
  emailResetTemplate:  'email_reset_template',
  // Stripe
  stripeEnabled:        'stripe_enabled',
  stripePublishableKey: 'stripe_publishable_key',
  stripeSecretKey:      'stripe_secret_key',
  stripeWebhookSecret:  'stripe_webhook_secret',
  stripeCurrency:       'stripe_currency',
  stripeCreditRate:     'stripe_credit_rate',
} as const

type Tab = 'basic' | 'email' | 'billing'

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('basic')
  const [vals, setVals] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  const tabs: { key: Tab; label: string }[] = [
    { key: 'basic', label: t('admin.settings.tabBasic') },
    { key: 'email', label: t('admin.settings.tabEmail') },
    { key: 'billing', label: t('admin.settings.tabBilling') },
  ]

  const magicVars = [
    { name: '{{.SiteName}}',  desc: t('admin.settings.var.siteName') },
    { name: '{{.Link}}',      desc: t('admin.settings.var.link') },
    { name: '{{.UserEmail}}', desc: t('admin.settings.var.userEmail') },
  ]

  const { data: settings, isLoading } = useQuery({
    queryKey: ['adminSettings'],
    queryFn: getSettings,
  })

  useEffect(() => {
    if (settings) setVals({ ...settings })
  }, [settings])

  const saveMut = useMutation({
    mutationFn: ({ key, value, isSecret }: { key: string; value: string; isSecret?: boolean }) =>
      upsertSetting({ key, value, is_secret: isSecret }),
    onSuccess: (_data, vars) => {
      setSaved((p) => ({ ...p, [vars.key]: true }))
      setTimeout(() => setSaved((p) => ({ ...p, [vars.key]: false })), 2000)
      qc.invalidateQueries({ queryKey: ['adminSettings'] })
    },
  })

  const set = (key: string, val: string) => setVals((p) => ({ ...p, [key]: val }))
  const val = (key: string) => vals[key] ?? ''
  const changed = (key: string) => val(key) !== (settings?.[key] ?? '')

  const save = (key: string, isSecret?: boolean) =>
    saveMut.mutate({ key, value: val(key), isSecret })

  if (isLoading) {
    return (
      <AppShell>
        <LoadingSpinner className="py-20" />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-5">
          <Settings className="h-5 w-5" aria-hidden />
          {t('admin.settings.title')}
        </h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-outline-variant">
          {tabs.map((it) => (
            <button
              key={it.key}
              onClick={() => setTab(it.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                tab === it.key
                  ? 'text-primary border-b-2 border-primary -mb-px'
                  : 'text-surface-on-variant hover:text-surface-on'
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>

        {/* ── 基本设置 ──────────────────────────────────────────────── */}
        {tab === 'basic' && (
          <div className="space-y-5">
            <Section title={t('admin.settings.sectionSiteInfo')}>
              <Field label={t('admin.settings.fieldSiteName')} hint={t('admin.settings.fieldSiteNameHint')}>
                <TextInput k={K.siteName} val={val} set={set} />
                <SaveBtn k={K.siteName} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.fieldSiteDesc')}>
                <TextInput k={K.siteDesc} val={val} set={set} />
                <SaveBtn k={K.siteDesc} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.fieldAdminPath')} hint={t('admin.settings.fieldAdminPathHint')}>
                <TextInput k={K.adminPath} val={val} set={set} />
                <SaveBtn k={K.adminPath} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field
                label={t('admin.settings.fieldBaseURL')}
                hint={t('admin.settings.fieldBaseURLHint')}
              >
                <TextInput k={K.appBaseURL} val={val} set={set} placeholder="https://yoursite.com" />
                <SaveBtn k={K.appBaseURL} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
            </Section>

            <Section title={t('admin.settings.sectionDefaults')}>
              <Field label={t('admin.settings.fieldStorageQuota')}>
                <TextInput k={K.storageQuota} val={val} set={set} type="number" />
                <SaveBtn k={K.storageQuota} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.fieldUploadLimit')}>
                <TextInput k={K.uploadLimit} val={val} set={set} type="number" />
                <SaveBtn k={K.uploadLimit} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
            </Section>
          </div>
        )}

        {/* ── 邮件设置 ──────────────────────────────────────────────── */}
        {tab === 'email' && (
          <div className="space-y-5">

            {/* 功能开关 */}
            <Section title={t('admin.settings.sectionFunctionSwitch')}>
              <ToggleField
                label={t('admin.settings.emailVerifyOn')}
                hint={t('admin.settings.emailVerifyHint')}
                checked={val(K.emailVerifyEnabled) === 'true'}
                onChange={(v) => {
                  set(K.emailVerifyEnabled, v ? 'true' : 'false')
                  saveMut.mutate({ key: K.emailVerifyEnabled, value: v ? 'true' : 'false' })
                }}
              />
              <ToggleField
                label={t('admin.settings.emailResetOn')}
                hint={t('admin.settings.emailResetHint')}
                checked={val(K.emailResetEnabled) === 'true'}
                onChange={(v) => {
                  set(K.emailResetEnabled, v ? 'true' : 'false')
                  saveMut.mutate({ key: K.emailResetEnabled, value: v ? 'true' : 'false' })
                }}
              />
            </Section>

            {/* 发信配置 */}
            <Section title={t('admin.settings.sectionResend')}>
              <Field label={t('admin.settings.fieldApiKey')} hint={t('admin.settings.fieldApiKeyHint')}>
                <input
                  type="password"
                  value={val(K.emailApiKey)}
                  onChange={(e) => set(K.emailApiKey, e.target.value)}
                  placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                  className="flex-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
                <SaveBtn k={K.emailApiKey} changed={changed} saved={saved} save={(k) => save(k, true)} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.fieldFromEmail')} hint={t('admin.settings.fieldFromEmailHint')}>
                <TextInput k={K.emailFrom} val={val} set={set} placeholder="noreply@example.com" />
                <SaveBtn k={K.emailFrom} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.fieldSenderName')} hint={t('admin.settings.fieldSenderNameHint')}>
                <TextInput k={K.emailSenderName} val={val} set={set} placeholder="MarsShare" />
                <SaveBtn k={K.emailSenderName} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
            </Section>

            {/* 魔法变量说明 */}
            <div className="bg-secondary-container/30 border border-secondary-container rounded-xl p-4">
              <p className="text-xs font-semibold text-surface-on-variant mb-2">{t('admin.settings.magicVars')}</p>
              <div className="space-y-1">
                {magicVars.map(({ name, desc }) => (
                  <div key={name} className="flex items-center gap-3">
                    <code className="text-xs bg-surface px-2 py-0.5 rounded font-mono text-primary select-all">
                      {name}
                    </code>
                    <span className="text-xs text-surface-on-variant">{desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-surface-on-variant mt-2 opacity-70">
                {t('admin.settings.magicVarsHint')}
              </p>
            </div>

            {/* 验证邮件模板 */}
            <Section title={t('admin.settings.sectionVerifyEmail')}>
              <Field label={t('admin.settings.fieldSubject')} hint={t('admin.settings.fieldSubjectHint')}>
                <TextInput k={K.emailVerifySubject} val={val} set={set} placeholder={t('admin.settings.verifySubjectPlaceholder')} />
                <SaveBtn k={K.emailVerifySubject} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <div className="space-y-1">
                <label className="text-xs text-surface-on-variant">{t('admin.settings.fieldTemplate')}</label>
                <TemplateEditor
                  value={val(K.emailVerifyTemplate)}
                  onChange={(v) => set(K.emailVerifyTemplate, v)}
                />
                <div className="flex justify-end">
                  <SaveBtn k={K.emailVerifyTemplate} changed={changed} saved={saved} save={save} mut={saveMut} />
                </div>
              </div>
            </Section>

            {/* 重置密码邮件模板 */}
            <Section title={t('admin.settings.sectionResetEmail')}>
              <Field label={t('admin.settings.fieldSubject')} hint={t('admin.settings.fieldSubjectHint')}>
                <TextInput k={K.emailResetSubject} val={val} set={set} placeholder={t('admin.settings.resetSubjectPlaceholder')} />
                <SaveBtn k={K.emailResetSubject} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <div className="space-y-1">
                <label className="text-xs text-surface-on-variant">{t('admin.settings.fieldTemplate')}</label>
                <TemplateEditor
                  value={val(K.emailResetTemplate)}
                  onChange={(v) => set(K.emailResetTemplate, v)}
                />
                <div className="flex justify-end">
                  <SaveBtn k={K.emailResetTemplate} changed={changed} saved={saved} save={save} mut={saveMut} />
                </div>
              </div>
            </Section>

          </div>
        )}

        {/* ── 收款（Stripe）设置 ───────────────────────────────────── */}
        {tab === 'billing' && (
          <div className="space-y-5">
            <Section title={t('admin.settings.sectionStripeSwitch')}>
              <ToggleField
                label={t('admin.settings.stripeEnabled')}
                hint={t('admin.settings.stripeEnabledHint')}
                checked={val(K.stripeEnabled) === 'true'}
                onChange={(v) => {
                  set(K.stripeEnabled, v ? 'true' : 'false')
                  saveMut.mutate({ key: K.stripeEnabled, value: v ? 'true' : 'false' })
                }}
              />
            </Section>

            <Section title={t('admin.settings.sectionStripeKeys')}>
              <Field label={t('admin.settings.stripePublishableKey')} hint={t('admin.settings.stripePublishableKeyHint')}>
                <TextInput k={K.stripePublishableKey} val={val} set={set} placeholder="pk_live_..." />
                <SaveBtn k={K.stripePublishableKey} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.stripeSecretKey')} hint={t('admin.settings.stripeSecretKeyHint')}>
                <input
                  type="password"
                  value={val(K.stripeSecretKey)}
                  onChange={(e) => set(K.stripeSecretKey, e.target.value)}
                  placeholder="sk_live_..."
                  className="flex-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
                <SaveBtn k={K.stripeSecretKey} changed={changed} saved={saved} save={(k) => save(k, true)} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.stripeWebhookSecret')} hint={t('admin.settings.stripeWebhookSecretHint')}>
                <input
                  type="password"
                  value={val(K.stripeWebhookSecret)}
                  onChange={(e) => set(K.stripeWebhookSecret, e.target.value)}
                  placeholder="whsec_..."
                  className="flex-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                />
                <SaveBtn k={K.stripeWebhookSecret} changed={changed} saved={saved} save={(k) => save(k, true)} mut={saveMut} />
              </Field>
            </Section>

            <Section title={t('admin.settings.sectionStripeCurrency')}>
              <Field label={t('admin.settings.stripeCurrency')} hint={t('admin.settings.stripeCurrencyHint')}>
                <TextInput k={K.stripeCurrency} val={val} set={set} placeholder="usd" />
                <SaveBtn k={K.stripeCurrency} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
              <Field label={t('admin.settings.stripeCreditRate')} hint={t('admin.settings.stripeCreditRateHint')}>
                <TextInput k={K.stripeCreditRate} val={val} set={set} type="number" placeholder="1.0" />
                <SaveBtn k={K.stripeCreditRate} changed={changed} saved={saved} save={save} mut={saveMut} />
              </Field>
            </Section>

            <div className="bg-secondary-container/30 border border-secondary-container rounded-xl p-4">
              <p className="text-xs font-semibold text-surface-on-variant mb-2">{t('admin.settings.stripeWebhookHelpTitle')}</p>
              <p className="text-xs text-surface-on-variant">
                {t('admin.settings.stripeWebhookHelp')}
              </p>
              <code className="block mt-2 text-xs bg-surface px-2 py-1 rounded font-mono text-primary select-all break-all">
                {(val(K.appBaseURL) || (typeof window !== 'undefined' ? window.location.origin : '')) + '/api/billing/stripe/webhook'}
              </code>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl shadow-elevation-1 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant">
        <h2 className="text-sm font-semibold text-surface-on">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  )
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-surface-on">{label}</label>
          {hint && <p className="text-xs text-surface-on-variant">{hint}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function TextInput({
  k, val, set, type = 'text', placeholder,
}: {
  k: string
  val: (key: string) => string
  set: (key: string, v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <input
      type={type}
      value={val(k)}
      onChange={(e) => set(k, e.target.value)}
      placeholder={placeholder}
      className="flex-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2 text-sm focus:outline-none focus:border-primary"
    />
  )
}

function SaveBtn({
  k, changed, saved, save, mut,
}: {
  k: string
  changed: (key: string) => boolean
  saved: Record<string, boolean>
  save: (key: string) => void
  mut: { isPending: boolean }
}) {
  const t = useT()
  return (
    <button
      onClick={() => save(k)}
      disabled={!changed(k) || mut.isPending}
      className="shrink-0 text-xs px-3 py-1.5 bg-primary text-primary-on rounded-lg disabled:opacity-40 hover:bg-primary/90 transition-colors"
    >
      {saved[k] ? t('common.savedCheck') : t('common.save')}
    </button>
  )
}

function ToggleField({
  label, hint, checked, onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm font-medium text-surface-on">{label}</p>
        {hint && <p className="text-xs text-surface-on-variant">{hint}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-outline'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

function TemplateEditor({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={12}
      spellCheck={false}
      className="w-full bg-surface-variant rounded-lg border border-outline px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary resize-y"
      placeholder={'<!DOCTYPE html>\n<html>\n<body>\n  <h1>{{.SiteName}}</h1>\n  <a href="{{.Link}}">Verify</a>\n</body>\n</html>'}
    />
  )
}
