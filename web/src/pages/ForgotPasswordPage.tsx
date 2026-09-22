import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { Mail } from '../components/icons'

export default function ForgotPasswordPage() {
  const t = useT()
  const { siteName } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await forgotPassword(email)
      setSent(true)
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
          <p className="text-sm text-surface-on-variant mt-1">{t('auth.forgotPasswordTitle')}</p>
        </div>

        <div className="bg-surface rounded-2xl shadow-elevation-2 p-6">
          {sent ? (
            <div className="text-center space-y-4">
              <Mail className="h-12 w-12 text-primary mx-auto" />
              <p className="text-sm text-surface-on">
                {t('auth.forgotPasswordSent')}
              </p>
              <Link to="/login" className="block text-sm text-primary hover:underline">
                {t('auth.backToLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-surface-on-variant">
                {t('auth.forgotPasswordDesc')}
              </p>
              <div>
                <label className="text-xs text-surface-on-variant">{t('auth.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>

              {error && (
                <p className="text-sm text-error bg-error-container/50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-primary text-primary-on rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? t('common.pleaseWait') : t('auth.sendResetLink')}
              </button>

              <div className="text-center">
                <Link to="/login" className="text-sm text-primary hover:underline">
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
