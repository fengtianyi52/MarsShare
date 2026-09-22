import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createAdminMembershipPlan,
  deleteAdminMembershipPlan,
  getAdminMembershipPlans,
  getSettings,
  getStoragePolicies,
  updateAdminMembershipPlan,
  upsertSetting,
} from '../../lib/api'
import type { AdminMembershipPlan, UpsertAdminMembershipPlanReq } from '../../types'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { Crown, Trash2, Pencil, Plus, X } from '../../components/icons'
import clsx from 'clsx'
import { useT } from '../../lib/i18n'
import { useConfirm } from '../../lib/notify'

const SETTING_DEFAULT_QUOTA = 'default_storage_quota_bytes'
const SETTING_DEFAULT_UPLOAD = 'default_upload_limit_bytes'

interface FormState {
  id: string | null
  name: string
  slug: string
  // 元/分 — UI 用元，提交时 *100
  price_yuan: number
  duration_days: number
  storage_policy_id: string
  storage_quota_gb: number
  upload_limit_mb: number
  is_active: boolean
  sort_order: number
}

const emptyForm: FormState = {
  id: null,
  name: '',
  slug: '',
  price_yuan: 0,
  duration_days: 30,
  storage_policy_id: '',
  storage_quota_gb: 20,
  upload_limit_mb: 1024,
  is_active: true,
  sort_order: 0,
}

function formStateToReq(s: FormState): UpsertAdminMembershipPlanReq {
  return {
    name: s.name.trim(),
    slug: s.slug.trim(),
    price_cents: Math.round(s.price_yuan * 100),
    duration_days: Math.max(1, Math.round(s.duration_days)),
    storage_policy_id: s.storage_policy_id || null,
    storage_quota_bytes: Math.max(0, Math.round(s.storage_quota_gb * 1024 * 1024 * 1024)),
    upload_limit_bytes: Math.max(0, Math.round(s.upload_limit_mb * 1024 * 1024)),
    is_active: s.is_active,
    sort_order: Math.round(s.sort_order),
  }
}

function planToFormState(p: AdminMembershipPlan): FormState {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price_yuan: p.price_cents / 100,
    duration_days: p.duration_days,
    storage_policy_id: p.storage_policy_id ?? '',
    storage_quota_gb: Math.round((p.storage_quota_bytes / (1024 * 1024 * 1024)) * 100) / 100,
    upload_limit_mb: Math.round((p.upload_limit_bytes / (1024 * 1024)) * 100) / 100,
    is_active: p.is_active,
    sort_order: p.sort_order,
  }
}

function formatBytesShort(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export default function AdminMembershipPage() {
  const t = useT()
  const { showConfirm } = useConfirm()
  const qc = useQueryClient()

  // ── Plans
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ['adminMembershipPlans'],
    queryFn: getAdminMembershipPlans,
  })

  const { data: storagePolicies } = useQuery({
    queryKey: ['storagePolicies'],
    queryFn: getStoragePolicies,
  })

  const { data: settings } = useQuery({
    queryKey: ['adminSettings'],
    queryFn: getSettings,
  })

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)

  // ── Default quotas (普通用户)
  const [defaultQuotaGB, setDefaultQuotaGB] = useState<number>(2)
  const [defaultUploadMB, setDefaultUploadMB] = useState<number>(100)
  const [defaultSavedFlash, setDefaultSavedFlash] = useState(false)

  useEffect(() => {
    if (!settings) return
    const q = Number(settings[SETTING_DEFAULT_QUOTA] || '')
    if (q > 0) setDefaultQuotaGB(Math.round((q / (1024 * 1024 * 1024)) * 100) / 100)
    const u = Number(settings[SETTING_DEFAULT_UPLOAD] || '')
    if (u > 0) setDefaultUploadMB(Math.round((u / (1024 * 1024)) * 100) / 100)
  }, [settings])

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = formStateToReq(form)
      if (form.id) {
        await updateAdminMembershipPlan(form.id, payload)
      } else {
        await createAdminMembershipPlan(payload)
      }
    },
    onSuccess: () => {
      resetForm()
      qc.invalidateQueries({ queryKey: ['adminMembershipPlans'] })
      qc.invalidateQueries({ queryKey: ['membershipPlans'] }) // wallet 页面
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminMembershipPlan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminMembershipPlans'] }),
  })

  const defaultsSaveMut = useMutation({
    mutationFn: async () => {
      const quotaBytes = Math.max(0, Math.round(defaultQuotaGB * 1024 * 1024 * 1024))
      const uploadBytes = Math.max(0, Math.round(defaultUploadMB * 1024 * 1024))
      await upsertSetting({ key: SETTING_DEFAULT_QUOTA, value: String(quotaBytes), is_secret: false })
      await upsertSetting({ key: SETTING_DEFAULT_UPLOAD, value: String(uploadBytes), is_secret: false })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adminSettings'] })
      setDefaultSavedFlash(true)
      window.setTimeout(() => setDefaultSavedFlash(false), 2200)
    },
  })

  const resetForm = () => {
    setShowForm(false)
    setForm(emptyForm)
    setValidationError(null)
  }

  const startCreate = () => {
    setForm({ ...emptyForm, sort_order: (plans?.length ?? 0) + 1 })
    setValidationError(null)
    setShowForm(true)
  }

  const startEdit = (p: AdminMembershipPlan) => {
    setForm(planToFormState(p))
    setValidationError(null)
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.name.trim()) return setValidationError(t('admin.membership.validationName'))
    if (!form.slug.trim()) return setValidationError(t('admin.membership.validationSlug'))
    if (form.duration_days <= 0) return setValidationError(t('admin.membership.validationDuration'))
    setValidationError(null)
    saveMut.mutate()
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on">
            <Crown className="h-5 w-5" aria-hidden />
            {t('admin.membership.title')}
          </h1>
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('admin.membership.new')}
          </button>
        </div>

        {/* 普通用户默认配额 */}
        <div className="bg-surface rounded shadow-elevation-1 p-5 mb-6">
          <h2 className="text-sm font-medium text-surface-on mb-1">{t('admin.membership.defaultQuota')}</h2>
          <p className="text-xs text-surface-on-variant mb-4">
            {t('admin.membership.defaultQuotaHint')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-surface-on-variant">{t('admin.membership.storageGB')}</label>
              <input
                type="number"
                min={0}
                step="0.1"
                value={defaultQuotaGB}
                onChange={(e) => setDefaultQuotaGB(Number(e.target.value))}
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
            </div>
            <div>
              <label className="text-xs text-surface-on-variant">{t('admin.membership.uploadMB')}</label>
              <input
                type="number"
                min={0}
                step="0.1"
                value={defaultUploadMB}
                onChange={(e) => setDefaultUploadMB(Number(e.target.value))}
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 justify-end mt-4">
            {defaultSavedFlash && <span className="text-xs text-success">{t('common.saved')}</span>}
            <button
              onClick={() => defaultsSaveMut.mutate()}
              disabled={defaultsSaveMut.isPending}
              className="px-5 py-1.5 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50"
            >
              {defaultsSaveMut.isPending ? t('common.saving') : t('admin.membership.saveDefault')}
            </button>
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-surface rounded shadow-elevation-1 p-5 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-surface-on">
                {form.id ? t('admin.membership.edit') : t('admin.membership.new')}
              </h2>
              <button onClick={resetForm} className="p-1 text-surface-on-variant hover:text-error rounded">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.name')} *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t('admin.membership.namePlaceholder')}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.slug')} *</label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="vip-year"
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm font-mono border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.price')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price_yuan}
                  onChange={(e) => setForm((f) => ({ ...f, price_yuan: Number(e.target.value) }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.duration')}</label>
                <input
                  type="number"
                  min={1}
                  value={form.duration_days}
                  onChange={(e) => setForm((f) => ({ ...f, duration_days: Number(e.target.value) }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.storageGB')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.storage_quota_gb}
                  onChange={(e) => setForm((f) => ({ ...f, storage_quota_gb: Number(e.target.value) }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.uploadMB')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.upload_limit_mb}
                  onChange={(e) => setForm((f) => ({ ...f, upload_limit_mb: Number(e.target.value) }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-surface-on-variant">{t('admin.membership.storagePolicy')}</label>
                <select
                  value={form.storage_policy_id}
                  onChange={(e) => setForm((f) => ({ ...f, storage_policy_id: e.target.value }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                >
                  <option value="">{t('admin.membership.siteDefault')}</option>
                  {storagePolicies?.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} · {sp.type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.membership.sort')}</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div className="flex items-center gap-2 self-end pb-2">
                <input
                  id="plan_is_active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="plan_is_active" className="text-sm text-surface-on">{t('common.enable')}</label>
              </div>
            </div>

            {validationError && (
              <p className="text-xs text-error">{validationError}</p>
            )}
            {saveMut.isError && (
              <p className="text-xs text-error">{(saveMut.error as Error).message}</p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saveMut.isPending}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50"
              >
                {saveMut.isPending ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        )}

        {/* Plans list */}
        {plansLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !plans || plans.length === 0 ? (
          <EmptyState icon={<Crown className="h-14 w-14" />} title={t('admin.membership.empty')} />
        ) : (
          <div className="space-y-3">
            {plans.map((p) => {
              const policy = storagePolicies?.find((sp) => sp.id === p.storage_policy_id)
              return (
                <div key={p.id} className="bg-surface rounded shadow-elevation-1 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-surface-on">{p.name}</h3>
                        <span className="text-xs px-2 py-0.5 bg-surface-variant rounded-full text-surface-on-variant font-mono">
                          {p.slug}
                        </span>
                        <span
                          className={clsx(
                            'text-xs px-2 py-0.5 rounded-full',
                            p.is_active
                              ? 'bg-success/15 text-success'
                              : 'bg-surface-variant text-surface-on-variant',
                          )}
                        >
                          {p.is_active ? t('common.enabled') : t('common.disabled')}
                        </span>
                      </div>
                      <p className="text-sm text-surface-on-variant mt-1.5">
                        {t('admin.membership.summary', {
                          price: (p.price_cents / 100).toFixed(2),
                          days: p.duration_days,
                          storage: formatBytesShort(p.storage_quota_bytes),
                          upload: formatBytesShort(p.upload_limit_bytes),
                        })}
                      </p>
                      <p className="text-xs text-surface-on-variant mt-1">
                        {policy
                          ? t('admin.membership.siteDefaultLabel', { policy: `${policy.name} · ${policy.type}` })
                          : t('admin.membership.siteDefaultFallback')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(p)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-3 py-1 rounded uppercase tracking-wider font-medium"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await showConfirm({
                            message: t('admin.membership.deleteConfirm', { name: p.name }),
                            danger: true,
                          })
                          if (ok) deleteMut.mutate(p.id)
                        }}
                        className="inline-flex items-center gap-1 text-xs text-error hover:bg-error/10 px-3 py-1 rounded uppercase tracking-wider font-medium"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
