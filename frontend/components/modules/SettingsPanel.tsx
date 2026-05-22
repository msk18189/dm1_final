'use client'
import { useState } from 'react'
import { Settings, Key, Database, Info } from 'lucide-react'

interface Props {
  repoLabel?: string
  onTokenChange?: (token: string) => void
}

export default function SettingsPanel({ repoLabel, onTokenChange }: Props) {
  const [token, setToken] = useState(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('github_token') || ''
  })
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    localStorage.setItem('github_token', token)
    onTokenChange?.(token)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-2xl border border-warm-200 bg-white p-6 space-y-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50">
            <Key className="h-4 w-4 text-indigo-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-primary">GitHub Token</h3>
            <p className="text-xs text-muted">Personal access token for higher rate limits (5000 req/hr)</p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 text-xs flex gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>PRISM works without a token for public repos. Adding a token enables large repository ingestion (100k+ PRs) without hitting rate limits.</span>
        </div>

        <div>
          <label className="text-xs text-secondary block mb-1.5">Personal Access Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="github_pat_..."
            className="w-full rounded-xl bg-white border border-warm-200 px-3 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-indigo-500 font-mono"
          />
          <p className="text-[10px] text-muted mt-1">
            Token scopes: public_repo or repo (private repos), read:project for Projects v2
          </p>
        </div>

        <button onClick={handleSave}
          className="btn-primary rounded-xl px-4 py-2 text-xs font-bold">
          {saved ? '✓ Saved' : 'Save Token'}
        </button>
      </div>

      <div className="rounded-2xl border border-warm-200 bg-white p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
            <Database className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-primary">Platform Info</h3>
            <p className="text-xs text-muted">PRISM v2.0 — Enterprise GitHub Intelligence</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            ['Architecture', 'Database-first (MySQL)'],
            ['Sync Mode', 'Incremental + Full pagination'],
            ['Projects API', 'GitHub Projects v2 (GraphQL)'],
            ['Rate Limit', 'Automatic sleep-and-resume'],
            ['Modules', '9 intelligence modules'],
            ['Current Repo', repoLabel ?? 'None selected'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-warm-50/50 border border-warm-200 p-3">
              <p className="text-muted mb-0.5">{k}</p>
              <p className="text-secondary font-medium">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
