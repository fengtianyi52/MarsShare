import { useEffect, useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { resendVerification, ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { MailCheck } from '../components/icons'

export default function AuthPage() {
  const t = useT()
  const location = useLocation()
  const isLogin = location.pathname === '/login'
  const navigate = useNavigate()
  const { login, register, siteName } = useAuth()

  const [form, setForm] = useState({ login: '', email: '', username: '', displayName: '', password: '', confirmPassword: '' })
  const [usernameError, setUsernameError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Surfaces a message left behind by a forced logout (e.g. account banned).
  const [logoutReason, setLogoutReason] = useState('')

  useEffect(() => {
    if (!isLogin) return
    try {
      const reason = sessionStorage.getItem('marsshare_logout_reason')
      if (reason) {
        setLogoutReason(reason)
        sessionStorage.removeItem('marsshare_logout_reason')
      }
    } catch { /* ignore */ }
  }, [isLogin])

  // Registration pending verification
  const [pendingEmail, setPendingEmail] = useState('')
  const [resent, setResent] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)

  // Login: email not verified
  const [unverifEmail, setUnverifEmail] = useState('')

  const USERNAME_RE = /^[a-z][a-z0-9_]{1,29}$/

  const set = (key: string, val: string) => {
    setForm((p) => ({ ...p, [key]: val }))
    if (key === 'username') {
      const v = val.toLowerCase()
      if (v && !USERNAME_RE.test(v)) {
        setUsernameError(t('auth.usernameRule'))
      } else {
        setUsernameError('')
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setUnverifEmail('')

    if (!isLogin && form.password !== form.confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    if (!isLogin && !USERNAME_RE.test(form.username)) {
      setError(t('auth.usernameRule'))
      return
    }

    setLoading(true)
    try {
      if (isLogin) {
        await login({ login: form.login, password: form.password })
        navigate('/')
      } else {
        const result = await register({
          email: form.email,
          username: form.username,
          display_name: form.displayName.trim() || undefined,
          password: form.password,
        })
        if (result.pending_verification) {
          setPendingEmail(result.email)
        } else {
          navigate('/')
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        // backend echoes the email in error.data.email
        const email = (err.data.email as string) || (form.login.includes('@') ? form.login : '')
        setUnverifEmail(email)
      } else {
        setError((err as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async (email: string) => {
    setResendLoading(true)
    try {
      await resendVerification(email)
      setResent(true)
    } catch {
      // ignore
    } finally {
      setResendLoading(false)
    }
  }

  // ── Registration pending verification ────────────────────────
  if (pendingEmail) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-primary">{siteName}</h1>
          </div>
          <div className="bg-surface rounded-2xl shadow-elevation-2 p-6 text-center space-y-4">
            <MailCheck className="h-14 w-14 text-primary mx-auto" />
            <h2 className="text-base font-semibold text-surface-on">{t('auth.verifyEmailPendingTitle')}</h2>
            <p className="text-sm text-surface-on-variant">
              {t('auth.verifyEmailPendingDesc', { email: pendingEmail })}
            </p>
            <p className="text-xs text-surface-on-variant opacity-70">
              {t('auth.verifyEmailNotReceived')}
            </p>
            {resent ? (
              <p className="text-sm text-primary font-medium">{t('auth.verifyEmailResent')}</p>
            ) : (
              <button
                onClick={() => handleResend(pendingEmail)}
                disabled={resendLoading}
                className="text-sm text-primary hover:underline disabled:opacity-50"
              >
                {resendLoading ? t('auth.sending') : t('auth.resendVerification')}
              </button>
            )}
            <Link to="/login" className="block text-sm text-surface-on-variant hover:underline">
              {t('auth.backToLogin')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">{siteName}</h1>
          <p className="text-sm text-surface-on-variant mt-1">
            {isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-2xl shadow-elevation-2 p-6">
          {logoutReason && (
            <div className="mb-4 text-sm text-error bg-error-container/50 px-3 py-2 rounded-lg">
              {logoutReason}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {isLogin ? (
              <div>
                <label className="text-xs text-surface-on-variant">{t('auth.emailOrUsername')}</label>
                <input
                  type="text"
                  value={form.login}
                  onChange={(e) => set('login', e.target.value)}
                  required
                  className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs text-surface-on-variant">{t('auth.email')}</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    required
                    className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-surface-on-variant">{t('auth.username')}</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => set('username', e.target.value.toLowerCase())}
                    required
                    placeholder={t('auth.usernameHint')}
                    className={`w-full mt-1 bg-surface-variant rounded-t-md border-b-2 px-3 py-2.5 text-sm focus:outline-none ${
                      usernameError ? 'border-error focus:border-error' : 'border-outline focus:border-primary'
                    }`}
                  />
                  {usernameError && (
                    <p className="text-xs text-error mt-1">{usernameError}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-surface-on-variant">{t('auth.displayName')} <span className="opacity-60">{t('auth.displayNameHint')}</span></label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => set('displayName', e.target.value)}
                    placeholder={t('auth.displayNamePlaceholder')}
                    className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-surface-on-variant">{t('auth.password')}</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                required
                className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
              />
            </div>

            {!isLogin && (
              <div>
                <label className="text-xs text-surface-on-variant">{t('auth.confirmPassword')}</label>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => set('confirmPassword', e.target.value)}
                  required
                  className="w-full mt-1 bg-surface-variant rounded-t-md border-b-2 border-outline px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>
            )}

            {/* Email not verified banner */}
            {unverifEmail && (
              <div className="bg-warning-container/50 border border-warning rounded-lg px-3 py-2.5 space-y-1.5">
                <p className="text-sm text-surface-on">{t('auth.unverifiedBanner')}</p>
                {resent ? (
                  <p className="text-xs text-primary font-medium">{t('auth.verifyEmailResent')}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleResend(unverifEmail)}
                    disabled={resendLoading}
                    className="text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    {resendLoading ? t('auth.sending') : t('auth.resendVerification')}
                  </button>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-error bg-error-container/50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary text-primary-on rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t('common.pleaseWait') : isLogin ? t('auth.login') : t('auth.register')}
            </button>
          </form>

          <div className="mt-4 flex flex-col items-center gap-2">
            <Link
              to={isLogin ? '/register' : '/login'}
              className="text-sm text-primary hover:underline"
            >
              {isLogin ? t('auth.goToRegister') : t('auth.goToLogin')}
            </Link>
            {isLogin && (
              <Link to="/forgot-password" className="text-sm text-surface-on-variant hover:underline">
                {t('auth.forgotPassword')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
