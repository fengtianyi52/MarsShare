import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'
import { en } from './en'
import { ja } from './ja'
import { eo } from './eo'

export const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'eo'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  eo: 'Esperanto',
}

export type MessageKey = string

export const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
  ja,
  eo,
}
