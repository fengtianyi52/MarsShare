import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { verifyEmail, resendVerification, setTokens, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import LoadingSpinner from '../components/LoadingSpinner'
import { MailCheck, CheckCircle2, XCircle } from '../components/icons'

export default function VerifyEmailPage() {
  const t = useT()
  const { siteName, refreshUser } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'idle'>('idle')
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendEmail, setResendEmail] = useState('')

  useEffect(() => {
    if (!token) return
    setStatus('loading')
    verifyEmail(token)
      .then(({ verified, authResponse }) => {
        if (!verified) {
          setStatus('error')
          setError(t('auth.verifyFailed'))
          return
        }
        setStatus('success')
        if (authResponse) {
          // Auto-login after verification
          setTokens(authResponse.access_token, authResponse.refresh_token)
          refreshUser().then(() => {
            setTimeout(() => navigate('/'), 1500)
          })
        } else {
          setTimeout(() => navigate('/login'), 2000)
        }
      })
      .catch((err) => {
        setStatus('error')
        setError(err instanceof ApiError ? err.message : t('auth.verifyLinkInvalid'))
      })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleResend = async () => {
    if (!resendEmail) return
    setResendLoading(true)
    try {
      await resendVerification(resendEmail)
      setResent(true)
    } catch {
      // ignore
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">{siteName}</h1>
          <p className="text-sm text-surface-on-variant mt-1">{t('auth.verifyEmail')}</p>
        </div>

        <div className="bg-surface rounded-2xl shadow-elevation-2 p-6 text-center space-y-4">

          {/* No token — show "check email" hint */}
          {!token && (
            <>
              <MailCheck className="h-12 w-12 text-primary mx-auto" />
              <p className="text-sm text-surface-on">
                {t('auth.verifyEmailSent')}
              </p>
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="w-full bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                {resent ? (
                  <p className="text-sm text-primary font-medium">{t('auth.verifyEmailResent')}</p>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={resendLoading || !resendEmail}
                    className="text-sm text-primary hover:underline disabled:opacity-50"
                  >
                    {resendLoading ? t('auth.sending') : t('auth.resendVerification')}
                  </button>
                )}
              </div>
              <Link to="/login" className="block text-sm text-surface-on-variant hover:underline">
                {t('auth.backToLogin')}
              </Link>
            </>
          )}

          {/* Verifying */}
          {token && status === 'loading' && (
            <>
              <LoadingSpinner />
              <p className="text-sm text-surface-on-variant">{t('auth.verifying')}</p>
            </>
          )}

          {/* Success */}
          {token && status === 'success' && (
            <>
              <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
              <p className="text-sm text-surface-on font-medium">{t('auth.verifySuccess')}</p>
              <p className="text-xs text-surface-on-variant">{t('auth.verifyRedirecting')}</p>
            </>
          )}

          {/* Error */}
          {token && status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-error mx-auto" />
              <p className="text-sm text-error">{error}</p>
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="w-full bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                {resent ? (
                  <p className="text-sm text-primary font-medium">{t('auth.verifyEmailResent')}</p>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={resendLoading || !resendEmail}
                    className="text-sm text-primary hover:underline disabled:opacity-50"
                  >
                    {resendLoading ? t('auth.sending') : t('auth.resendVerification')}
                  </button>
                )}
              </div>
              <Link to="/login" className="block text-sm text-surface-on-variant hover:underline">
                {t('auth.backToLogin')}
              </Link>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
