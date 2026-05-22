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
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10">
            <Key className="h-4 w-4 text-indigo-300" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">GitHub Token</h3>
            <p className="text-xs text-white/40">Personal access token for higher rate limits (5000 req/hr)</p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-300 text-xs flex gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>PRISM works without a token for public repos. Adding a token enables large repository ingestion (100k+ PRs) without hitting rate limits.</span>
        </div>

        <div>
          <label className="text-xs text-white/50 block mb-1.5">Personal Access Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="github_pat_..."
            className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 font-mono"
          />
          <p className="text-[10px] text-white/25 mt-1">
            Token scopes: public_repo or repo (private repos), read:project for Projects v2
          </p>
        </div>

        <button onClick={handleSave}
          className="btn-primary rounded-xl px-4 py-2 text-xs font-bold">
          {saved ? '✓ Saved' : 'Save Token'}
        </button>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10">
            <Database className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Platform Info</h3>
            <p className="text-xs text-white/40">PRISM v2.0 — Enterprise GitHub Intelligence</p>
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
            <div key={k} className="rounded-xl bg-white/[0.03] border border-white/[0.04] p-3">
              <p className="text-white/30 mb-0.5">{k}</p>
              <p className="text-white/70 font-medium">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
