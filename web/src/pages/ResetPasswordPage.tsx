import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { resetPassword } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { CheckCircle2 } from '../components/icons'

export default function ResetPasswordPage() {
  const t = useT()
  const { siteName } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) setError(t('auth.resetLinkInvalid'))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await resetPassword(token, form.password)
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">{siteName}</h1>
          <p className="text-sm text-surface-on-variant mt-1">{t('auth.passwordResetTitle')}</p>
        </div>

        <div className="bg-surface rounded-2xl shadow-elevation-2 p-6">
          {done ? (
            <div className="text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
              <p className="text-sm text-surface-on">{t('auth.passwordResetSuccess')}</p>
              <Link to="/login" className="text-sm text-primary hover:underline">{t('auth.loginNow')}</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-surface-on-variant">{t('auth.newPassword')}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  required
                  minLength={6}
                  className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-surface-on-variant">{t('auth.confirmNewPassword')}</label>
                <input
                  type="password"
                  value={form.confirm}
                  onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
                  required
                  className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>

              {error && (
                <p className="text-sm text-error bg-error-container/50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !token}
                className="w-full py-2.5 bg-primary text-primary-on rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? t('common.pleaseWait') : t('auth.setNewPassword')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
