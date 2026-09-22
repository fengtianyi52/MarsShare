import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminCreateHotSearch,
  adminDeleteHotSearch,
  adminListHotSearches,
  adminRecomputeHotSearches,
  adminUpdateHotSearch,
  type AdminUpsertHotSearchReq,
} from '../../lib/api'
import type { HotSearch } from '../../types'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { Flame, Plus, Pencil, Trash2, X, RotateCcw } from '../../components/icons'
import clsx from 'clsx'
import { useT } from '../../lib/i18n'
import { useConfirm } from '../../lib/notify'

interface FormState {
  id: string | null
  keyword: string
  link_type: 'topic' | 'search' | 'url'
  link_value: string
  pinned_rank: string // string so empty input means "no pin"
  hidden: boolean
  score: number
}

const emptyForm: FormState = {
  id: null,
  keyword: '',
  link_type: 'topic',
  link_value: '',
  pinned_rank: '',
  hidden: false,
  score: 0,
}

function toReq(f: FormState): AdminUpsertHotSearchReq {
  const rank = f.pinned_rank.trim() === '' ? null : Number(f.pinned_rank)
  return {
    keyword: f.keyword.trim(),
    link_type: f.link_type,
    link_value: f.link_value.trim(),
    pinned_rank: Number.isFinite(rank) ? rank : null,
    hidden: f.hidden,
    score: Number(f.score) || 0,
  }
}

function fromHotSearch(h: HotSearch): FormState {
  return {
    id: h.id,
    keyword: h.keyword,
    link_type: (h.link_type as FormState['link_type']) || 'topic',
    link_value: h.link_value,
    pinned_rank: h.pinned_rank == null ? '' : String(h.pinned_rank),
    hidden: h.hidden,
    score: h.score,
  }
}

export default function AdminHotSearchPage() {
  const t = useT()
  const { showConfirm } = useConfirm()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)

  const { data: items, isLoading } = useQuery({
    queryKey: ['adminHotSearches'],
    queryFn: adminListHotSearches,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['adminHotSearches'] })
    qc.invalidateQueries({ queryKey: ['hotSearches'] })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = toReq(form)
      if (form.id) {
        await adminUpdateHotSearch(form.id, payload)
      } else {
        await adminCreateHotSearch(payload)
      }
    },
    onSuccess: () => {
      resetForm()
      refresh()
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteHotSearch(id),
    onSuccess: refresh,
  })

  const recomputeMut = useMutation({
    mutationFn: () => adminRecomputeHotSearches(),
    onSuccess: refresh,
  })

  const resetForm = () => {
    setShowForm(false)
    setForm(emptyForm)
    setValidationError(null)
  }

  const startCreate = () => {
    setForm(emptyForm)
    setValidationError(null)
    setShowForm(true)
  }

  const startEdit = (h: HotSearch) => {
    setForm(fromHotSearch(h))
    setValidationError(null)
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.keyword.trim()) return setValidationError(t('admin.hotSearch.keywordRequired'))
    if (form.link_type !== 'search' && !form.link_value.trim()) {
      return setValidationError(t('admin.hotSearch.valueRequired'))
    }
    setValidationError(null)
    saveMut.mutate()
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on">
            <Flame className="h-5 w-5 text-error" aria-hidden />
            {t('admin.hotSearch.title')}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => recomputeMut.mutate()}
              disabled={recomputeMut.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-surface-variant text-surface-on rounded text-sm font-medium uppercase tracking-wider hover:bg-surface-variant/80 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {recomputeMut.isPending ? t('admin.hotSearch.recomputing') : t('admin.hotSearch.recompute')}
            </button>
            <button
              onClick={startCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('admin.hotSearch.add')}
            </button>
          </div>
        </div>

        <p className="text-xs text-surface-on-variant mb-4">
          {t('admin.hotSearch.desc')}
        </p>

        {/* Form */}
        {showForm && (
          <div className="bg-surface rounded shadow-elevation-1 p-5 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-surface-on">
                {form.id ? t('admin.hotSearch.editTitle') : t('admin.hotSearch.addTitle')}
              </h2>
              <button onClick={resetForm} className="p-1 text-surface-on-variant hover:text-error rounded">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs text-surface-on-variant">{t('admin.hotSearch.keyword')} *</label>
                <input
                  value={form.keyword}
                  onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                  placeholder={t('admin.hotSearch.keywordPlaceholder')}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.hotSearch.linkType')}</label>
                <select
                  value={form.link_type}
                  onChange={(e) => setForm((f) => ({ ...f, link_type: e.target.value as FormState['link_type'] }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                >
                  <option value="topic">{t('admin.hotSearch.linkTypeTopic')}</option>
                  <option value="search">{t('admin.hotSearch.linkTypeSearch')}</option>
                  <option value="url">{t('admin.hotSearch.linkTypeUrl')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">
                  {form.link_type === 'topic'
                    ? t('admin.hotSearch.linkValueTopic')
                    : form.link_type === 'url'
                      ? t('admin.hotSearch.linkValueUrl')
                      : t('admin.hotSearch.linkValueSearch')}
                </label>
                <input
                  value={form.link_value}
                  onChange={(e) => setForm((f) => ({ ...f, link_value: e.target.value }))}
                  placeholder={form.link_type === 'topic' ? 'world-cup' : form.link_type === 'url' ? 'https://...' : ''}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm font-mono border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.hotSearch.pinnedRank')}</label>
                <input
                  type="number"
                  min={1}
                  value={form.pinned_rank}
                  onChange={(e) => setForm((f) => ({ ...f, pinned_rank: e.target.value }))}
                  placeholder="1"
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.hotSearch.baseScore')}</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.score}
                  onChange={(e) => setForm((f) => ({ ...f, score: Number(e.target.value) }))}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div className="flex items-center gap-2 self-end pb-2">
                <input
                  id="hot_hidden"
                  type="checkbox"
                  checked={form.hidden}
                  onChange={(e) => setForm((f) => ({ ...f, hidden: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="hot_hidden" className="text-sm text-surface-on">{t('admin.hotSearch.hidden')}</label>
              </div>
            </div>

            {validationError && <p className="text-xs text-error">{validationError}</p>}
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

        {/* List */}
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !items || items.length === 0 ? (
          <EmptyState icon={<Flame className="h-14 w-14" />} title={t('admin.hotSearch.empty')} />
        ) : (
          <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-variant text-xs text-surface-on-variant uppercase">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">{t('admin.hotSearch.colKeyword')}</th>
                  <th className="text-left px-3 py-2">{t('admin.hotSearch.colType')}</th>
                  <th className="text-left px-3 py-2">{t('admin.hotSearch.colLinkValue')}</th>
                  <th className="text-right px-3 py-2 w-16">{t('admin.hotSearch.colScore')}</th>
                  <th className="text-center px-3 py-2 w-14">{t('admin.hotSearch.colPinned')}</th>
                  <th className="text-center px-3 py-2 w-14">{t('admin.hotSearch.colHidden')}</th>
                  <th className="text-center px-3 py-2 w-16">{t('admin.hotSearch.colSource')}</th>
                  <th className="text-right px-3 py-2 w-32">{t('admin.hotSearch.colAction')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((h, idx) => (
                  <tr key={h.id} className="border-t border-divider">
                    <td className="px-3 py-2 text-surface-on-variant tabular-nums">{idx + 1}</td>
                    <td className="px-3 py-2 text-surface-on truncate max-w-[180px]">{h.keyword}</td>
                    <td className="px-3 py-2 text-xs text-surface-on-variant">{h.link_type}</td>
                    <td className="px-3 py-2 text-xs font-mono text-surface-on-variant truncate max-w-[160px]">
                      {h.link_value || t('common.dash')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-surface-on-variant">
                      {h.score.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {h.pinned_rank == null ? (
                        <span className="text-surface-on-variant">{t('common.dash')}</span>
                      ) : (
                        <span className="text-warning font-bold">#{h.pinned_rank}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {h.hidden ? <span className="text-error">{t('common.yes')}</span> : <span className="text-surface-on-variant">{t('common.no')}</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={clsx(
                          'text-[10px] px-1.5 py-0.5 rounded-full',
                          h.source === 'manual'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-surface-variant text-surface-on-variant',
                        )}
                      >
                        {h.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => startEdit(h)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded"
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await showConfirm({
                            message: t('admin.hotSearch.deleteConfirm', { name: h.keyword }),
                            danger: true,
                          })
                          if (ok) deleteMut.mutate(h.id)
                        }}
                        className="inline-flex items-center gap-1 text-xs text-error hover:bg-error/10 px-2 py-1 rounded ml-1"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
