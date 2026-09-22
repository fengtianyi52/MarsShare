import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getStoragePolicies, createStoragePolicy, updateStoragePolicy,
  deleteStoragePolicy, testStoragePolicy,
} from '../../lib/api'
import type { StoragePolicy, CreateStoragePolicyReq, StoragePolicyType } from '../../types'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { HardDrive } from '../../components/icons'
import clsx from 'clsx'
import { useT } from '../../lib/i18n'
import { useConfirm } from '../../lib/notify'

// ────────────────────────────────────────────────────────────
// Provider 元数据：参考 Cloudreve，每种存储后端定义自己的字段
// ────────────────────────────────────────────────────────────

type ProviderFieldKey =
  | 'endpoint'
  | 'region'
  | 'bucket'
  | 'access_key'
  | 'secret_key'
  | 'local_path'

interface ProviderField {
  key: ProviderFieldKey
  label: string
  placeholder?: string
  help?: string
  required?: boolean
  secret?: boolean
}

interface ProviderDef {
  type: StoragePolicyType
  label: string
  description: string
  fields: ProviderField[]
}

type TFn = (key: string, vars?: Record<string, string | number>) => string

function buildProviders(t: TFn): ProviderDef[] {
  return [
    {
      type: 'local',
      label: t('admin.storage.provider.local'),
      description: t('admin.storage.provider.localDesc'),
      fields: [
        {
          key: 'local_path',
          label: t('admin.storage.provider.localPathLabel'),
          placeholder: '/data/storage',
          help: t('admin.storage.provider.localPathHelp'),
          required: true,
        },
      ],
    },
    {
      type: 's3',
      label: t('admin.storage.provider.s3'),
      description: t('admin.storage.provider.s3Desc'),
      fields: [
        {
          key: 'endpoint',
          label: 'Endpoint',
          placeholder: t('admin.storage.provider.s3EndpointPlaceholder'),
          help: t('admin.storage.provider.s3EndpointHelp'),
        },
        { key: 'region', label: 'Region', placeholder: 'us-east-1', required: true },
        { key: 'bucket', label: t('admin.storage.provider.bucketLabel'), placeholder: 'my-bucket', required: true },
        { key: 'access_key', label: 'Access Key ID', secret: true, required: true },
        { key: 'secret_key', label: 'Secret Access Key', secret: true, required: true },
      ],
    },
    {
      type: 'oss',
      label: t('admin.storage.provider.oss'),
      description: t('admin.storage.provider.ossDesc'),
      fields: [
        {
          key: 'endpoint',
          label: 'Endpoint',
          placeholder: 'https://oss-cn-hangzhou.aliyuncs.com',
          help: t('admin.storage.provider.ossEndpointHelp'),
          required: true,
        },
        { key: 'region', label: 'Region', placeholder: 'oss-cn-hangzhou', required: true },
        { key: 'bucket', label: t('admin.storage.provider.bucketLabel'), required: true },
        { key: 'access_key', label: t('admin.storage.provider.ossAccessKey'), secret: true, required: true },
        { key: 'secret_key', label: t('admin.storage.provider.ossSecretKey'), secret: true, required: true },
      ],
    },
    {
      type: 'cos',
      label: t('admin.storage.provider.cos'),
      description: t('admin.storage.provider.cosDesc'),
      fields: [
        {
          key: 'endpoint',
          label: 'Endpoint',
          placeholder: 'https://cos.ap-shanghai.myqcloud.com',
          help: t('admin.storage.provider.cosEndpointHelp'),
          required: true,
        },
        { key: 'region', label: 'Region', placeholder: 'ap-shanghai', required: true },
        {
          key: 'bucket',
          label: t('admin.storage.provider.bucketLabel'),
          placeholder: 'mybucket-1234567890',
          help: t('admin.storage.provider.cosBucketHelp'),
          required: true,
        },
        { key: 'access_key', label: 'SecretId', secret: true, required: true },
        { key: 'secret_key', label: 'SecretKey', secret: true, required: true },
      ],
    },
    {
      type: 'qiniu',
      label: t('admin.storage.provider.qiniu'),
      description: t('admin.storage.provider.qiniuDesc'),
      fields: [
        {
          key: 'endpoint',
          label: 'Endpoint',
          placeholder: 'https://s3-cn-east-1.qiniucs.com',
          help: t('admin.storage.provider.qiniuEndpointHelp'),
          required: true,
        },
        { key: 'region', label: 'Region', placeholder: 'cn-east-1', required: true },
        { key: 'bucket', label: t('admin.storage.provider.bucketLabel'), required: true },
        { key: 'access_key', label: t('admin.storage.provider.qiniuAccessKey'), secret: true, required: true },
        { key: 'secret_key', label: 'SecretKey', secret: true, required: true },
      ],
    },
    {
      type: 'upyun',
      label: t('admin.storage.provider.upyun'),
      description: t('admin.storage.provider.upyunDesc'),
      fields: [
        {
          key: 'endpoint',
          label: 'Endpoint',
          placeholder: 'https://s3.upyun.com',
          help: t('admin.storage.provider.upyunEndpointHelp'),
          required: true,
        },
        { key: 'bucket', label: t('admin.storage.provider.upyunBucketLabel'), required: true },
        { key: 'access_key', label: t('admin.storage.provider.upyunAccessKey'), secret: true, required: true },
        { key: 'secret_key', label: t('admin.storage.provider.upyunSecretKey'), secret: true, required: true },
      ],
    },
  ]
}

// ────────────────────────────────────────────────────────────
// 表单状态
// ────────────────────────────────────────────────────────────

interface FormState {
  name: string
  type: StoragePolicyType
  is_default: boolean
  max_file_size_mb: number
  allowed_types_str: string
  // backend connection fields
  endpoint: string
  region: string
  bucket: string
  access_key: string
  secret_key: string
  local_path: string
  // advanced
  dir_naming_rule: string
  file_naming_rule: string
  base_url: string
  is_private: boolean
  proxy_download: boolean
  url_expire_seconds: number
}

const emptyForm: FormState = {
  name: '',
  type: 'local',
  is_default: false,
  max_file_size_mb: 100,
  allowed_types_str: '',
  endpoint: '',
  region: '',
  bucket: '',
  access_key: '',
  secret_key: '',
  local_path: '/data/storage',
  dir_naming_rule: '{uid}/{date}',
  file_naming_rule: '{random}{ext}',
  base_url: '',
  is_private: true,
  proxy_download: false,
  url_expire_seconds: 3600,
}

function formStateToPayload(s: FormState): CreateStoragePolicyReq {
  const allowedTypes = s.allowed_types_str
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return {
    name: s.name,
    type: s.type,
    is_default: s.is_default,
    max_file_size: Math.max(0, Math.round(s.max_file_size_mb * 1024 * 1024)),
    allowed_types: allowedTypes,
    endpoint: s.endpoint,
    region: s.region,
    bucket: s.bucket,
    access_key: s.access_key,
    secret_key: s.secret_key,
    local_path: s.local_path,
    base_url: s.base_url,
    dir_naming_rule: s.dir_naming_rule,
    file_naming_rule: s.file_naming_rule,
    is_private: s.is_private,
    proxy_download: s.proxy_download,
    url_expire_seconds: s.url_expire_seconds,
  }
}

function policyToFormState(p: StoragePolicy): FormState {
  return {
    name: p.name,
    type: (p.type as StoragePolicyType) || 'local',
    is_default: p.is_default,
    max_file_size_mb: Math.round((p.max_file_size || 0) / (1024 * 1024)),
    allowed_types_str: (p.allowed_types ?? []).join(', '),
    endpoint: p.endpoint || '',
    region: p.region || '',
    bucket: p.bucket || '',
    // 后端永远不返回密钥，编辑时留空表示不修改
    access_key: '',
    secret_key: '',
    local_path: p.local_path || '/data/storage',
    dir_naming_rule: p.dir_naming_rule || '{uid}/{date}',
    file_naming_rule: p.file_naming_rule || '{random}{ext}',
    base_url: p.base_url || '',
    is_private: p.is_private,
    proxy_download: p.proxy_download,
    url_expire_seconds: p.url_expire_seconds || 3600,
  }
}

function validateForm(
  form: FormState,
  isEdit: boolean,
  providers: ProviderDef[],
  t: TFn,
): string | null {
  if (!form.name.trim()) return t('admin.storage.validation.missingName')
  const provider = providers.find((p) => p.type === form.type) ?? providers[0]
  for (const field of provider.fields) {
    if (!field.required) continue
    // 编辑模式下，密钥字段允许留空（保留旧值）
    if (isEdit && field.secret) continue
    const value = (form[field.key] ?? '').toString().trim()
    if (!value) return t('admin.storage.validation.missingField', { field: field.label })
  }
  return null
}

// ────────────────────────────────────────────────────────────
// 页面组件
// ────────────────────────────────────────────────────────────

export default function AdminStoragePage() {
  const t = useT()
  const { showConfirm } = useConfirm()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null)

  const providers = buildProviders(t)
  const getProvider = (type: string): ProviderDef =>
    providers.find((p) => p.type === type) ?? providers[0]

  const { data: policies, isLoading } = useQuery({
    queryKey: ['storagePolicies'],
    queryFn: getStoragePolicies,
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = formStateToPayload(form)
      if (editingId) {
        await updateStoragePolicy(editingId, payload)
      } else {
        await createStoragePolicy(payload)
      }
    },
    onSuccess: () => {
      resetForm()
      qc.invalidateQueries({ queryKey: ['storagePolicies'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteStoragePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storagePolicies'] }),
  })

  const testMut = useMutation({
    mutationFn: (id: string) => testStoragePolicy(id),
    onSuccess: (data, id) => {
      setTestResult({ id, ok: data.success, msg: data.success ? t('admin.storage.testSuccess') : data.message })
    },
    onError: (err: Error, id) => {
      setTestResult({ id, ok: false, msg: err.message || t('admin.storage.testFailed') })
    },
  })

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
    setShowAdvanced(false)
    setValidationError(null)
  }

  const startCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const startEdit = (p: StoragePolicy) => {
    setEditingId(p.id)
    setForm(policyToFormState(p))
    setShowAdvanced(false)
    setValidationError(null)
    setShowForm(true)
  }

  const handleSave = () => {
    const err = validateForm(form, Boolean(editingId), providers, t)
    if (err) {
      setValidationError(err)
      return
    }
    setValidationError(null)
    saveMut.mutate()
  }

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const provider = getProvider(form.type)

  function formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(0)} MB`
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on">
            <HardDrive className="h-5 w-5" aria-hidden />
            {t('admin.storage.title')}
          </h1>
          <button
            onClick={startCreate}
            className="px-4 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
          >
            {t('admin.storage.new')}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-surface rounded shadow-elevation-1 p-6 mb-6 space-y-5">
            <h2 className="text-sm font-medium text-surface-on">
              {editingId ? t('admin.storage.edit') : t('admin.storage.new')}
            </h2>

            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.storage.policyName')} *</label>
                <input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder={t('admin.storage.policyNamePlaceholder')}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.storage.backend')} *</label>
                <select
                  value={form.type}
                  onChange={(e) => updateField('type', e.target.value as StoragePolicyType)}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                >
                  {providers.map((p) => (
                    <option key={p.type} value={p.type}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-surface-on-variant -mt-2">{provider.description}</p>

            {/* Provider 专属字段 */}
            <div className="space-y-4 pt-2 border-t border-outline-variant">
              <h3 className="text-xs font-medium text-surface-on-variant uppercase tracking-wider">
                {t('admin.storage.connection', { provider: provider.label })}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {provider.fields.map((field) => {
                  const value = form[field.key] as string
                  const showSecretHint = editingId && field.secret
                  return (
                    <div key={field.key} className={field.help ? 'col-span-2' : ''}>
                      <label className="text-xs text-surface-on-variant">
                        {field.label}{field.required && !showSecretHint ? ' *' : ''}
                      </label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        autoComplete={field.secret ? 'new-password' : 'off'}
                        value={value}
                        onChange={(e) => updateField(field.key, e.target.value as FormState[typeof field.key])}
                        placeholder={showSecretHint ? t('admin.storage.secretHint') : field.placeholder}
                        className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                      />
                      {field.help && (
                        <p className="text-xs text-surface-on-variant mt-1">{field.help}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 上传限制 */}
            <div className="space-y-4 pt-2 border-t border-outline-variant">
              <h3 className="text-xs font-medium text-surface-on-variant uppercase tracking-wider">
                {t('admin.storage.uploadLimits')}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-surface-on-variant">{t('admin.storage.maxFileSize')}</label>
                  <input
                    type="number"
                    min={1}
                    value={form.max_file_size_mb}
                    onChange={(e) => updateField('max_file_size_mb', Number(e.target.value) || 0)}
                    className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                  />
                </div>
                <div className="flex items-center gap-2 self-end pb-2">
                  <input
                    id="is_default"
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => updateField('is_default', e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="is_default" className="text-sm text-surface-on">{t('admin.storage.setDefault')}</label>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-surface-on-variant">{t('admin.storage.allowedTypes')}</label>
                  <input
                    value={form.allowed_types_str}
                    onChange={(e) => updateField('allowed_types_str', e.target.value)}
                    placeholder="image/*, application/pdf, video/*"
                    className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                  />
                </div>
              </div>
            </div>

            {/* 高级设置 */}
            <div className="pt-2 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-medium text-primary uppercase tracking-wider hover:underline"
              >
                {showAdvanced ? t('admin.storage.advancedOpen') : t('admin.storage.advancedClosed')}
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="text-xs text-surface-on-variant">{t('admin.storage.dirRule')}</label>
                    <input
                      value={form.dir_naming_rule}
                      onChange={(e) => updateField('dir_naming_rule', e.target.value)}
                      placeholder="{uid}/{date}"
                      className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm font-mono border border-outline focus:outline-none focus:border-primary focus:border-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-surface-on-variant">{t('admin.storage.fileRule')}</label>
                    <input
                      value={form.file_naming_rule}
                      onChange={(e) => updateField('file_naming_rule', e.target.value)}
                      placeholder="{random}{ext}"
                      className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm font-mono border border-outline focus:outline-none focus:border-primary focus:border-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-surface-on-variant">
                      {t('admin.storage.availableVars')} <code>{'{uid}'}</code> <code>{'{date}'}</code> <code>{'{random}'}</code> <code>{'{original}'}</code> <code>{'{ext}'}</code> <code>{'{uuid}'}</code>
                    </p>
                  </div>
                  {form.type !== 'local' && (
                    <>
                      <div className="col-span-2">
                        <label className="text-xs text-surface-on-variant">{t('admin.storage.cdnDomain')}</label>
                        <input
                          value={form.base_url}
                          onChange={(e) => updateField('base_url', e.target.value)}
                          placeholder="https://cdn.example.com"
                          className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-surface-on-variant">{t('admin.storage.signedExpire')}</label>
                        <input
                          type="number"
                          min={60}
                          value={form.url_expire_seconds}
                          onChange={(e) => updateField('url_expire_seconds', Number(e.target.value) || 3600)}
                          className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                        />
                      </div>
                      <div className="flex flex-col gap-2 self-end pb-2">
                        <label className="inline-flex items-center gap-2 text-sm text-surface-on">
                          <input
                            type="checkbox"
                            checked={form.is_private}
                            onChange={(e) => updateField('is_private', e.target.checked)}
                            className="rounded"
                          />
                          {t('admin.storage.privateBucket')}
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-surface-on">
                          <input
                            type="checkbox"
                            checked={form.proxy_download}
                            onChange={(e) => updateField('proxy_download', e.target.checked)}
                            className="rounded"
                          />
                          {t('admin.storage.proxyDownload')}
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saveMut.isPending}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {saveMut.isPending ? t('common.saving') : t('common.save')}
              </button>
            </div>
            {validationError && (
              <p className="text-xs text-error">{validationError}</p>
            )}
            {saveMut.isError && (
              <p className="text-xs text-error">{(saveMut.error as Error).message}</p>
            )}
          </div>
        )}

        {/* Policies list */}
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !policies || policies.length === 0 ? (
          <EmptyState icon={<HardDrive className="h-14 w-14" />} title={t('admin.storage.empty')} />
        ) : (
          <div className="space-y-4">
            {policies.map((p) => {
              const providerDef = getProvider(p.type)
              return (
                <div key={p.id} className="bg-surface rounded shadow-elevation-1 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-surface-on">{p.name}</h3>
                        <span className="text-xs px-2 py-0.5 bg-surface-variant rounded-full text-surface-on-variant">
                          {providerDef.label}
                        </span>
                        {p.is_default && (
                          <span className="text-xs px-2 py-0.5 bg-primary/15 text-primary rounded-full">
                            {t('admin.storage.default')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-on-variant mt-1">
                        {t('admin.storage.maxFile', { size: formatBytes(p.max_file_size) })} | {t('admin.storage.allowedTypesLabel', { types: p.allowed_types?.join(', ') || t('admin.storage.allowedAll') })}
                      </p>
                      {p.type === 'local'
                        ? <p className="text-xs text-surface-on-variant mt-0.5">{t('admin.storage.pathLabel', { path: '' })}<code>{p.local_path || '-'}</code></p>
                        : <p className="text-xs text-surface-on-variant mt-0.5">{t('admin.storage.bucketLabel', { bucket: '' })}<code>{p.bucket || '-'}</code>{p.region ? <> · {t('admin.storage.regionLabel', { region: '' })}<code>{p.region}</code></> : null}</p>
                      }
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testMut.mutate(String(p.id))}
                        disabled={testMut.isPending}
                        className="text-xs text-primary hover:bg-primary/10 px-3 py-1 rounded uppercase tracking-wider font-medium transition-colors"
                      >
                        {t('admin.storage.test')}
                      </button>
                      <button
                        onClick={() => startEdit(p)}
                        className="text-xs text-primary hover:bg-primary/10 px-3 py-1 rounded uppercase tracking-wider font-medium transition-colors"
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await showConfirm({
                            message: t('admin.storage.deleteConfirm'),
                            danger: true,
                          })
                          if (ok) deleteMut.mutate(String(p.id))
                        }}
                        className="text-xs text-error hover:bg-error/10 px-3 py-1 rounded uppercase tracking-wider font-medium transition-colors"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                  {testResult?.id === String(p.id) && (
                    <p className={clsx(
                      'text-xs mt-2',
                      testResult.ok ? 'text-success' : 'text-error',
                    )}>
                      {testResult.msg}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
