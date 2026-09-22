import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { getHotSearches, getSearchSuggest } from '../lib/api'
import type { Topic, User as UserType } from '../types'
import UserAvatar from './UserAvatar'
import BannedBadge from './BannedBadge'
import { Search, Flame, Clock, X } from './icons'
import { useT } from '../lib/i18n'

const HISTORY_KEY = 'pts_search_history'
const HISTORY_LIMIT = 5

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((v) => typeof v === 'string').slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function saveHistory(items: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)))
  } catch {
    // ignore
  }
}

export default function SearchBox() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)

  // Debounce input → suggest query.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [value])

  // Close dropdown on route change.
  useEffect(() => {
    setOpen(false)
    inputRef.current?.blur()
  }, [location.pathname, location.search])

  // Click outside → close.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const { data: hotSearches = [] } = useQuery({
    queryKey: ['hotSearches'],
    queryFn: getHotSearches,
    staleTime: 60000,
    enabled: open,
  })

  const { data: suggest } = useQuery({
    queryKey: ['searchSuggest', debounced],
    queryFn: () => getSearchSuggest(debounced),
    enabled: open && debounced.length > 0,
    staleTime: 30000,
  })

  const showSuggest = open && debounced.length > 0
  const suggestTopics: Topic[] = suggest?.topics ?? []
  const suggestUsers: UserType[] = suggest?.users ?? []

  const submitSearch = (q: string) => {
    const term = q.trim()
    if (!term) return
    const next = [term, ...history.filter((h) => h !== term)].slice(0, HISTORY_LIMIT)
    setHistory(next)
    saveHistory(next)
    setValue('')
    setOpen(false)
    navigate(`/search?q=${encodeURIComponent(term)}`)
  }

  const removeHistory = (term: string) => {
    const next = history.filter((h) => h !== term)
    setHistory(next)
    saveHistory(next)
  }

  const goToTopic = (slug: string) => {
    setOpen(false)
    setValue('')
    navigate(`/topics/${slug}`)
  }

  const goToUser = (username: string) => {
    setOpen(false)
    setValue('')
    navigate(`/u/${username}`)
  }

  const goToHotItem = (h: import('../types').HotSearch) => {
    if (h.link_type === 'topic') {
      goToTopic(h.link_value)
    } else if (h.link_type === 'url' && h.link_value) {
      window.open(h.link_value, '_blank', 'noopener,noreferrer')
      setOpen(false)
    } else {
      submitSearch(h.link_value || h.keyword)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitSearch(value)
    } else if (e.key === 'Escape') {
      setValue('')
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showEmptyState = useMemo(() => {
    if (showSuggest) return suggestTopics.length === 0 && suggestUsers.length === 0
    return history.length === 0 && hotSearches.length === 0
  }, [showSuggest, suggestTopics.length, suggestUsers.length, history.length, hotSearches.length])

  return (
    <div ref={containerRef} className="relative flex-1 max-w-xl mx-auto">
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={t('search.placeholder')}
          className="w-full bg-white/15 hover:bg-white/20 focus:bg-white/25 rounded px-4 py-2 pl-10 text-sm text-primary-on placeholder:text-primary-on/70 focus:outline-none focus:ring-2 focus:ring-white/40 transition-colors"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary-on/80" aria-hidden />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('')
              inputRef.current?.focus()
            }}
            aria-label={t('search.clearAria')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-primary-on/70 hover:bg-white/15"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-surface text-surface-on rounded shadow-elevation-8 border border-divider z-40 overflow-hidden">
          {showSuggest ? (
            <div className="max-h-96 overflow-y-auto scrollbar-thin">
              {suggestTopics.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-surface-on-variant">
                    {t('search.topicsHeader')}
                  </div>
                  {suggestTopics.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => goToTopic(topic.slug)}
                      className="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-surface-variant"
                    >
                      <span className="text-primary truncate">#{topic.name}</span>
                      <span className="text-xs text-surface-on-variant tabular-nums shrink-0">
                        {topic.post_count} {t('search.postCountShort')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {suggestUsers.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-surface-on-variant">
                    {t('search.usersHeader')}
                  </div>
                  {suggestUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => goToUser(u.username)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm hover:bg-surface-variant"
                    >
                      <UserAvatar src={u.avatar_url} name={u.display_name || u.username} size="sm" />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="inline-flex items-center gap-1 truncate text-surface-on">
                          {u.display_name || u.username}
                          <BannedBadge user={u} />
                        </p>
                        <p className="truncate text-xs text-surface-on-variant">@{u.username}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="border-t border-divider mt-1">
                <button
                  type="button"
                  onClick={() => submitSearch(value)}
                  className="w-full px-4 py-2 text-left text-sm text-primary hover:bg-primary/10"
                >
                  {t('search.allResults', { query: value })}
                </button>
              </div>
              {showEmptyState && (
                <div className="px-4 py-6 text-center text-sm text-surface-on-variant">
                  {t('search.pressEnter', { query: value })}
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto scrollbar-thin">
              {history.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <span className="text-[11px] uppercase tracking-wider text-surface-on-variant inline-flex items-center gap-1.5">
                      <Clock className="h-3 w-3" aria-hidden />
                      {t('search.recentSearches')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHistory([])
                        saveHistory([])
                      }}
                      className="text-xs text-surface-on-variant hover:text-error"
                    >
                      {t('common.clear')}
                    </button>
                  </div>
                  {history.map((term) => (
                    <div
                      key={term}
                      className="group flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-variant"
                    >
                      <button
                        type="button"
                        onClick={() => submitSearch(term)}
                        className="flex-1 text-left truncate text-surface-on"
                      >
                        {term}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeHistory(term)}
                        aria-label={t('common.remove')}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-surface-on-variant hover:text-error"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {hotSearches.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-surface-on-variant inline-flex items-center gap-1.5">
                    <Flame className="h-3 w-3 text-error" aria-hidden />
                    {t('search.hotList')}
                  </div>
                  {hotSearches.slice(0, 10).map((h, idx) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => goToHotItem(h)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm hover:bg-surface-variant"
                    >
                      <span
                        className={clsx(
                          'w-5 text-center text-xs font-bold tabular-nums shrink-0',
                          idx < 3 ? 'text-error' : 'text-surface-on-variant',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className="flex-1 truncate text-left text-surface-on">{h.keyword}</span>
                      {h.pinned_rank != null && (
                        <span className="text-[10px] text-warning shrink-0">{t('search.hotPinned')}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {showEmptyState && (
                <div className="px-4 py-6 text-center text-sm text-surface-on-variant">
                  {t('common.empty.noContent')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
