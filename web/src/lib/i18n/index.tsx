import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { messages, type Locale, type MessageKey, LOCALES } from './locales'

export type LanguagePref = Locale | 'system'

interface LanguageContextValue {
  /** 用户选择的语言（含 system） */
  pref: LanguagePref
  /** 实际生效的语言代码 */
  locale: Locale
  /** 切换语言 */
  setPref: (pref: LanguagePref) => void
  /** 翻译函数 */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
}

const STORAGE_KEY = 'pts-lang'

const LanguageContext = createContext<LanguageContextValue | null>(null)

function readStored(): LanguagePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'system') return 'system'
    if (v && (LOCALES as readonly string[]).includes(v)) return v as Locale
  } catch {
    /* ignore */
  }
  return 'system'
}

function detectSystemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const langs: string[] = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? [...navigator.languages]
    : [navigator.language || '']

  // 第一轮：只要偏好列表中任意位置出现中文，就使用中文。
  // 这样做的原因：很多双语用户的浏览器把英文排在中文前面（例如装了英文版 Chrome 的中文用户），
  // 严格按"首选语言"匹配会导致中文用户被误判为英文。中文起源的产品应优先尊重"中文存在性"。
  for (const raw of langs) {
    const lang = raw.toLowerCase()
    if (lang.startsWith('zh')) {
      // 简繁判断：包含 tw / hk / mo / hant 视为繁体；其余视为简体
      if (/(-tw|-hk|-mo|hant)/.test(lang)) return 'zh-TW'
      return 'zh-CN'
    }
  }

  // 第二轮：偏好列表中没有中文 — 按用户偏好顺序匹配其他支持语言
  for (const raw of langs) {
    const lang = raw.toLowerCase()
    if (lang.startsWith('ja')) return 'ja'
    if (lang.startsWith('eo')) return 'eo'
    if (lang.startsWith('en')) return 'en'
  }

  // 最终回退：中文（产品起源语言）。无法识别的语言（如 fr/de）也回退到中文，
  // 用户可在「设置 → 语言」中手动切换为 English / 日本語 / Esperanto。
  return 'zh-CN'
}

function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`))
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LanguagePref>(() => readStored())
  const [systemLocale, setSystemLocale] = useState<Locale>(() => detectSystemLocale())

  // 监听系统语言变化（部分浏览器支持）
  useEffect(() => {
    const handler = () => setSystemLocale(detectSystemLocale())
    window.addEventListener('languagechange', handler)
    return () => window.removeEventListener('languagechange', handler)
  }, [])

  const locale: Locale = pref === 'system' ? systemLocale : pref

  // 同步到 <html lang>
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setPref = useCallback((next: LanguagePref) => {
    setPrefState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>): string => {
      const dict = messages[locale] as Record<string, string>
      const fallback = messages['en'] as Record<string, string>
      const tpl = dict[key] ?? fallback[key] ?? key
      return format(tpl, vars)
    },
    [locale],
  )

  const value = useMemo<LanguageContextValue>(
    () => ({ pref, locale, setPref, t }),
    [pref, locale, setPref, t],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}

export function useT() {
  return useLanguage().t
}

/**
 * 静态翻译函数 — 用于非 React 上下文（api 客户端、provider 内部抛错等），
 * 每次调用都会从 localStorage 读取语言偏好，因此不会自动响应语言切换，但适合一次性错误消息。
 */
export function tStatic(key: MessageKey, vars?: Record<string, string | number>): string {
  const stored = readStored()
  const locale: Locale = stored === 'system' ? detectSystemLocale() : stored
  const dict = messages[locale] as Record<string, string>
  const fallback = messages['en'] as Record<string, string>
  const tpl = dict[key] ?? fallback[key] ?? key
  return format(tpl, vars)
}

export type { Locale, MessageKey } from './locales'
export { LOCALES, LOCALE_LABELS } from './locales'
