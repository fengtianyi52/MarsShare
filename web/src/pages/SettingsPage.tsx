import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateProfile, changePassword } from '../lib/api'
import { useAuth } from '../lib/auth'
import AppShell from '../components/layout/AppShell'
import UserAvatar from '../components/UserAvatar'
import { Settings as SettingsIcon, Sun, Moon, Monitor } from '../components/icons'
import { useTheme, type ThemeMode } from '../lib/theme'
import { useLanguage, useT, LOCALES, type LanguagePref } from '../lib/i18n'
import { LOCALE_LABELS } from '../lib/i18n/locales'
import clsx from 'clsx'

export default function SettingsPage() {
  const t = useT()
  const { user, setUser } = useAuth()
  const { mode, setMode } = useTheme()
  const { pref: langPref, setPref: setLangPref } = useLanguage()
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarDataUrl, setAvatarDataUrl] = useState<string>('')
  const [avatarPending, setAvatarPending] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saved, setSaved] = useState(false)

  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSaved, setPwSaved] = useState(false)

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name)
      setBio(user.bio || '')
      setAvatarUrl(user.avatar_url || '')
      setAvatarDataUrl(user.avatar_data_url || '')
    }
  }, [user])

  const profileMut = useMutation({
    mutationFn: () => updateProfile({
      display_name: displayName,
      bio,
      avatar_url: avatarUrl,
      ...(avatarPending ? { avatar_data_url: avatarPending } : {}),
    }),
    onSuccess: (updated) => {
      setUser(updated)
      setAvatarUrl(updated.avatar_url || '')
      setAvatarDataUrl(updated.avatar_data_url || '')
      setAvatarPending('')
      qc.invalidateQueries({ queryKey: ['feed'] })
      qc.invalidateQueries({ queryKey: ['publicFeed'] })
      qc.invalidateQueries({ queryKey: ['trending'] })
      qc.invalidateQueries({ queryKey: ['post'] })
      qc.invalidateQueries({ queryKey: ['userProfile'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = Math.min(img.width, img.height)
        const sx = (img.width - size) / 2
        const sy = (img.height - size) / 2
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256)
        setAvatarPending(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const pwMut = useMutation({
    mutationFn: () => changePassword({ old_password: oldPw, new_password: newPw }),
    onSuccess: () => {
      setOldPw('')
      setNewPw('')
      setConfirmPw('')
      setPwSaved(true)
      setTimeout(() => setPwSaved(false), 2000)
    },
  })

  const handlePwSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    if (newPw !== confirmPw) {
      setPwError(t('auth.passwordMismatch'))
      return
    }
    if (newPw.length < 6) {
      setPwError(t('auth.passwordTooShort'))
      return
    }
    pwMut.mutate()
  }

  return (
    <AppShell>
      <div className="max-w-xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-6">
          <SettingsIcon className="h-5 w-5" aria-hidden />
          {t('settings.title')}
        </h1>

        {/* Appearance section */}
        <div className="bg-surface rounded shadow-elevation-1 p-6 mb-6">
          <h2 className="text-sm font-medium text-surface-on-variant mb-4">{t('settings.appearance')}</h2>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: 'light', label: t('theme.light'), Icon: Sun },
              { value: 'dark', label: t('theme.dark'), Icon: Moon },
              { value: 'system', label: t('theme.system'), Icon: Monitor },
            ] as const).map(({ value, label, Icon }) => {
              const active = mode === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value as ThemeMode)}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-4 rounded border transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-divider text-surface-on-variant hover:bg-surface-variant',
                  )}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                  <span className="text-xs">{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Language section */}
        <div className="bg-surface rounded shadow-elevation-1 p-6 mb-6">
          <h2 className="text-sm font-medium text-surface-on-variant mb-4">{t('settings.language')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(['system', ...LOCALES] as const).map((value) => {
              const active = langPref === value
              const label = value === 'system' ? t('settings.language.system') : LOCALE_LABELS[value]
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLangPref(value as LanguagePref)}
                  className={clsx(
                    'flex items-center justify-center gap-2 px-3 py-2.5 rounded border text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-divider text-surface-on-variant hover:bg-surface-variant',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Profile section */}
        <div className="bg-surface rounded shadow-elevation-1 p-6 mb-6">
          <h2 className="text-sm font-medium text-surface-on-variant mb-4">{t('settings.profile')}</h2>

          <div className="flex items-center gap-4 mb-4">
            <UserAvatar
              dataUrl={avatarPending || avatarDataUrl}
              src={avatarUrl}
              name={displayName || '?'}
              size="lg"
            />
            <div className="flex-1">
              <label className="text-xs text-surface-on-variant">{t('user.avatar')}</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-surface-variant rounded text-xs hover:bg-surface-variant/80"
                >
                  {t('common.selectImage')}
                </button>
                {avatarPending && (
                  <button
                    type="button"
                    onClick={() => setAvatarPending('')}
                    className="px-3 py-1.5 text-xs text-surface-on-variant hover:text-error"
                  >
                    {t('common.cancel')}
                  </button>
                )}
                <span className="text-xs text-surface-on-variant">
                  {avatarPending ? t('user.avatarCropNotice') : t('user.avatarAutoCrop')}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-surface-on-variant">{t('user.displayName')}</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
            </div>
            <div>
              <label className="text-xs text-surface-on-variant">{t('user.bio')}</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2 resize-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-4">
            {saved && <span className="text-xs text-primary">{t('common.saved')}</span>}
            {profileMut.isError && (
              <span className="text-xs text-error">{(profileMut.error as Error).message}</span>
            )}
            <button
              onClick={() => profileMut.mutate()}
              disabled={profileMut.isPending}
              className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
            >
              {profileMut.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        {/* Password section */}
        <div className="bg-surface rounded shadow-elevation-1 p-6">
          <h2 className="text-sm font-medium text-surface-on-variant mb-4">{t('auth.changePasswordTitle')}</h2>
          <form onSubmit={handlePwSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-surface-on-variant">{t('auth.currentPassword')}</label>
              <input
                type="password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                required
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
            </div>
            <div>
              <label className="text-xs text-surface-on-variant">{t('auth.newPassword')}</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
            </div>
            <div>
              <label className="text-xs text-surface-on-variant">{t('auth.confirmNewPassword')}</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                className="w-full mt-1 bg-surface rounded px-3 py-2 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
              />
            </div>
            {pwError && <p className="text-xs text-error">{pwError}</p>}
            {pwMut.isError && <p className="text-xs text-error">{(pwMut.error as Error).message}</p>}
            <div className="flex items-center justify-end gap-3">
              {pwSaved && <span className="text-xs text-primary">{t('auth.passwordChanged')}</span>}
              <button
                type="submit"
                disabled={pwMut.isPending}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {pwMut.isPending ? t('common.saving') : t('auth.changePassword')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  )
}
