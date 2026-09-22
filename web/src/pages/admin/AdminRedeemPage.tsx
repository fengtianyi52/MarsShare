import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRedeemBatches, createRedeemBatch } from '../../lib/api'
import type { RedeemCode } from '../../types'
import AppShell from '../../components/layout/AppShell'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { Ticket } from '../../components/icons'
import { useT } from '../../lib/i18n'

export default function AdminRedeemPage() {
  const t = useT()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [count, setCount] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [generatedCodes, setGeneratedCodes] = useState<RedeemCode[]>([])

  const { data: batches, isLoading } = useQuery({
    queryKey: ['redeemBatches'],
    queryFn: getRedeemBatches,
  })

  const createMut = useMutation({
    mutationFn: () => createRedeemBatch({
      name,
      amount: Number(amount),
      count: Number(count),
      expires_at: expiresAt || undefined,
    }),
    onSuccess: (data) => {
      setGeneratedCodes(data.codes)
      setShowForm(false)
      setName('')
      setAmount('')
      setCount('')
      setExpiresAt('')
      qc.invalidateQueries({ queryKey: ['redeemBatches'] })
    },
  })

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on">
            <Ticket className="h-5 w-5" aria-hidden />
            {t('admin.redeem.title')}
          </h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
          >
            {t('admin.redeem.createBatch')}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-surface rounded shadow-elevation-1 p-6 mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.redeem.batchName')}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.redeem.amount')}</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.redeem.count')}</label>
                <input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('admin.redeem.expiresAt')}</label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!name || !amount || !count || createMut.isPending}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {createMut.isPending ? t('common.creating') : t('common.create')}
              </button>
            </div>
            {createMut.isError && (
              <p className="text-xs text-error">{(createMut.error as Error).message}</p>
            )}
          </div>
        )}

        {/* Generated codes */}
        {generatedCodes.length > 0 && (
          <div className="bg-primary/10 rounded p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-primary">{t('admin.redeem.generated')}</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedCodes.map((c) => c.code).join('\n'))
                }}
                className="text-xs text-primary hover:underline"
              >
                {t('admin.redeem.copyAll')}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {generatedCodes.map((c) => (
                <code key={c.id} className="text-xs bg-surface px-2 py-1 rounded font-mono">{c.code}</code>
              ))}
            </div>
          </div>
        )}

        {/* Batches list */}
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !batches || batches.length === 0 ? (
          <EmptyState icon={<Ticket className="h-14 w-14" />} title={t('admin.redeem.empty')} />
        ) : (
          <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider text-left text-surface-on-variant">
                  <th className="py-3 px-4 font-medium">{t('admin.redeem.colName')}</th>
                  <th className="py-3 px-4 font-medium w-20">{t('admin.redeem.colAmount')}</th>
                  <th className="py-3 px-4 font-medium w-24">{t('admin.redeem.colUsed')}</th>
                  <th className="py-3 px-4 font-medium w-28">{t('admin.redeem.colExpires')}</th>
                  <th className="py-3 px-4 font-medium w-28">{t('admin.redeem.colCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-divider hover:bg-surface-variant/50">
                    <td className="py-3 px-4 font-medium text-surface-on">{b.name}</td>
                    <td className="py-3 px-4 text-surface-on-variant">{b.amount.toFixed(2)}</td>
                    <td className="py-3 px-4 text-surface-on-variant">{b.used_count}/{b.count}</td>
                    <td className="py-3 px-4 text-surface-on-variant text-xs">
                      {b.expires_at ? new Date(b.expires_at).toLocaleDateString('zh-CN') : t('common.never')}
                    </td>
                    <td className="py-3 px-4 text-surface-on-variant text-xs">
                      {new Date(b.created_at).toLocaleDateString('zh-CN')}
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
