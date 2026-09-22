import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'
import ImageLightbox, { type LightboxImage } from './ImageLightbox'

interface Props {
  content: string
  className?: string
}

// Matches #tag# tokens. Requires a closing # so we don't collide with
// markdown headings (`# heading`). The character class mirrors the backend
// regex in api/internal/store/social.go (alphanumerics + CJK + underscore).
const TAG_REGEX = /#([\p{L}\p{N}_]+)#/gu

// Matches @username mentions. Only valid usernames (our own regex rules).
const MENTION_REGEX = /@([a-z][a-z0-9_]{1,29})\b/g

function preprocessTags(content: string): string {
  return content.replace(TAG_REGEX, (match, name: string) => {
    const slug = name.toLowerCase()
    return `[${match}](/topics/${encodeURIComponent(slug)})`
  })
}

function preprocessMentions(content: string): string {
  return content.replace(MENTION_REGEX, (_, username) => `[@${username}](/u/${username})`)
}

function buildComponents(openLightbox: (src: string, alt?: string) => void): Components {
  return {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const code = String(children).replace(/\n$/, '')
    if (match) {
      return (
        <SyntaxHighlighter
          style={oneLight}
          language={match[1]}
          PreTag="div"
          className="rounded-md !bg-surface-variant text-sm my-2"
        >
          {code}
        </SyntaxHighlighter>
      )
    }
    return (
      <code className="bg-surface-variant px-1.5 py-0.5 rounded text-sm" {...props}>
        {children}
      </code>
    )
  },
  a({ href, children }) {
    // Internal links (e.g. /topics/<slug>, /post/<id>, /u/<name>) are routed
    // via React Router so the click stays inside the SPA. The TAG_REGEX
    // pre-processing in this file produces /topics/<slug> hrefs which we
    // also want to highlight differently from regular markdown links.
    if (href && href.startsWith('/')) {
      const isTopic = href.startsWith('/topics/')
      const isMention = href.startsWith('/u/')
      return (
        <Link
          to={href}
          className={
            isTopic
              ? 'text-primary font-medium hover:underline'
              : isMention
                ? 'text-secondary font-semibold hover:underline'
                : 'text-primary hover:underline'
          }
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </Link>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    )
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  },
  ul({ children }) {
    return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-4 border-primary pl-3 my-2 text-surface-on-variant italic">
        {children}
      </blockquote>
    )
  },
  h1({ children }) { return <h1 className="text-xl font-bold mb-2">{children}</h1> },
  h2({ children }) { return <h2 className="text-lg font-bold mb-2">{children}</h2> },
  h3({ children }) { return <h3 className="text-base font-bold mb-1">{children}</h3> },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full text-sm border border-outline-variant rounded-md">
          {children}
        </table>
      </div>
    )
  },
  th({ children }) {
    return <th className="px-3 py-2 bg-surface-variant text-left font-medium border-b border-outline-variant">{children}</th>
  },
  td({ children }) {
    return <td className="px-3 py-2 border-b border-outline-variant">{children}</td>
  },
  img({ src, alt }) {
    if (!src) return null
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openLightbox(src, alt)
        }}
        className="my-2 max-h-64 max-w-full cursor-zoom-in rounded-md border border-outline-variant object-contain transition-transform hover:scale-[1.02]"
      />
    )
  },
  }
}

export default function MarkdownRenderer({ content, className }: Props) {
  const processed = useMemo(() => preprocessMentions(preprocessTags(content)), [content])
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null)
  const components = useMemo(
    () => buildComponents((src, alt) => setLightbox({ src, alt })),
    [],
  )
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
      <ImageLightbox
        images={lightbox ? [lightbox] : []}
        index={lightbox ? 0 : -1}
        onClose={() => setLightbox(null)}
      />
    </div>
  )
}
