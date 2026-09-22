import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User, LoginReq, RegisterReq } from '../types'
import * as api from './api'
import { tStatic } from './i18n'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  setupRequired: boolean
  adminPath: string
  siteName: string
  login: (data: LoginReq) => Promise<void>
  register: (data: RegisterReq) => Promise<import('./api').RegisterResult>
  logout: () => Promise<void>
  setUser: (u: User | null) => void
  markSetupDone: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Retry fetching setup status when API is not ready yet (e.g. during container startup)
async function waitForSetupStatus(maxRetries = 10): Promise<api.SetupStatus> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await api.getSetupStatus()
    } catch {
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }
  // Fallback: assume setup done with default values
  return { setup_complete: true, admin_path: 'admin', site_name: 'MarsShare' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [adminPath, setAdminPath] = useState('admin')
  const [siteName, setSiteName] = useState('MarsShare')

  useEffect(() => {
    let cancelled = false

    async function init() {
      const status = await waitForSetupStatus()

      if (cancelled) return

      setAdminPath(status.admin_path || 'admin')
      setSiteName(status.site_name || 'MarsShare')

      if (!status.setup_complete) {
        setSetupRequired(true)
        setIsLoading(false)
        return
      }

      // Try to restore session from stored tokens
      const token = api.getAccessToken()
      if (token) {
        try {
          const me = await api.getMe()
          if (!cancelled) setUser(me)
        } catch {
          // Token expired or invalid — clear silently, user will need to log in
          api.clearTokens()
        }
      }

      if (!cancelled) setIsLoading(false)
    }

    init()
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (data: LoginReq) => {
    const res = await api.login(data)
    api.setTokens(res.access_token, res.refresh_token)
    // Drop the previous account's cached responses (likes, follows, feeds,
    // drive tree, notifications, etc.) so the new user sees their own state.
    queryClient.clear()
    setUser(res.user)
  }, [queryClient])

  const register = useCallback(async (data: RegisterReq): Promise<api.RegisterResult> => {
    const res = await api.register(data)
    if (!res.pending_verification) {
      api.setTokens(res.access_token, res.refresh_token)
      queryClient.clear()
      setUser(res.user)
    }
    return res
  }, [queryClient])

  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* ignore */ }
    api.clearTokens()
    queryClient.clear()
    setUser(null)
  }, [queryClient])

  // Listen for the BANNED signal from apiFetch and force-logout immediately.
  // This handles the case where the user was banned mid-session: their JWT
  // is still cryptographically valid until expiry, but the backend now
  // rejects every authenticated request with code "BANNED". When that
  // happens we drop the session and redirect to /login so they cannot
  // continue to use the app.
  useEffect(() => {
    function onBanned(e: Event) {
      const detail = (e as CustomEvent<{ message?: string }>).detail
      api.clearTokens()
      queryClient.clear()
      setUser(null)
      const msg = detail?.message || tStatic('auth.accountBanned')
      try {
        sessionStorage.setItem('marsshare_logout_reason', msg)
      } catch { /* ignore */ }
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login')
      }
    }
    window.addEventListener(api.BANNED_EVENT, onBanned)
    return () => window.removeEventListener(api.BANNED_EVENT, onBanned)
  }, [queryClient])

  const markSetupDone = useCallback(() => {
    setSetupRequired(false)
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.getMe()
      setUser(me)
    } catch { /* ignore */ }
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      setupRequired,
      adminPath,
      siteName,
      login,
      register,
      logout,
      setUser,
      markSetupDone,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
