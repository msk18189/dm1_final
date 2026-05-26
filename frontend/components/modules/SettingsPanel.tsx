'use client'

import { useState } from 'react'
import { Settings, Key, Database, Info, Sparkles, RefreshCw, Shield, BellRing, Save } from 'lucide-react'

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

  // Local settings switches state for premium high-fidelity dashboard storytelling
  const [aiSummary, setAiSummary] = useState(true)
  const [aiRisk, setAiRisk] = useState(true)
  const [backgroundSync, setBackgroundSync] = useState(false)
  const [rateLimitRecover, setRateLimitRecover] = useState(true)
  const [notifySlack, setNotifySlack] = useState(false)

  const handleSave = () => {
    localStorage.setItem('github_token', token)
    onTokenChange?.(token)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-4xl">

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* GitHub Token configuration */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 shrink-0">
                <Key className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">GitHub Access Token</h3>
                <p className="text-[10px] text-slate-400 font-semibold">Higher rate limits (5,000 requests/hr)</p>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-indigo-950 text-xs flex gap-2 leading-relaxed">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-indigo-500" />
              <span>PRISM operates without a token for public repos. Adding a token enables private repository ingestion and avoids GitHub API limits.</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Personal Access Token</label>
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="github_pat_..."
                className="w-full rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 font-mono transition"
              />
              <p className="text-[9px] text-slate-400 font-semibold">
                Required scopes: <code className="font-bold text-slate-650">public_repo</code> or <code className="font-bold text-slate-650">repo</code> (private), <code className="font-bold text-slate-650">read:project</code>
              </p>
            </div>
          </div>

          <button onClick={handleSave}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 mt-4">
            <Save className="h-3.5 w-3.5" />
            {saved ? '✓ Token Saved' : 'Save Access Token'}
          </button>
        </div>

        {/* AI Insight Settings */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 border border-violet-100 text-violet-600 shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">AI Analytics Settings</h3>
              <p className="text-[10px] text-slate-400 font-semibold">Configure intelligence models and reporting</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {[
              { id: 'ai-summary', label: 'Enable AI-generated Executive Summaries', desc: 'Synthesizes repository logs into a plain-text paragraph', value: aiSummary, onChange: setAiSummary },
              { id: 'ai-risk', label: 'Run Predictive PR Risk Analyses', desc: 'Flags risky commits and bottleneck reviewer structures', value: aiRisk, onChange: setAiRisk },
            ].map((cfg) => (
              <div key={cfg.id} className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <label htmlFor={cfg.id} className="text-xs font-bold text-slate-800 block cursor-pointer">{cfg.label}</label>
                  <p className="text-[10px] text-slate-400 font-semibold">{cfg.desc}</p>
                </div>
                <button
                  type="button"
                  id={cfg.id}
                  onClick={() => cfg.onChange(!cfg.value)}
                  className={`w-9 h-5 rounded-full shrink-0 relative transition-all duration-200 border ${
                    cfg.value ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-100 border-slate-200'
                  }`}
                >
                  <div className={`h-3.5 w-3.5 bg-white rounded-full shadow absolute top-0.5 transition-all duration-205 ${
                    cfg.value ? 'left-4.5' : 'left-0.5'
                  }`} />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Sync Settings */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 border border-amber-100 text-amber-600 shrink-0">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Ingestion & Sync Configuration</h3>
              <p className="text-[10px] text-slate-400 font-semibold">Database updates and rate limit throttling</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {[
              { id: 'bg-sync', label: 'Background Incremental Syncing', desc: 'Sync database records in background every 1 hour', value: backgroundSync, onChange: setBackgroundSync },
              { id: 'rate-limit', label: 'Automatic Rate-Limiting Recovery', desc: 'Sleeps and auto-resumes ingestion when PAT budget ends', value: rateLimitRecover, onChange: setRateLimitRecover },
            ].map((cfg) => (
              <div key={cfg.id} className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <label htmlFor={cfg.id} className="text-xs font-bold text-slate-800 block cursor-pointer">{cfg.label}</label>
                  <p className="text-[10px] text-slate-400 font-semibold">{cfg.desc}</p>
                </div>
                <button
                  type="button"
                  id={cfg.id}
                  onClick={() => cfg.onChange(!cfg.value)}
                  className={`w-9 h-5 rounded-full shrink-0 relative transition-all duration-200 border ${
                    cfg.value ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-100 border-slate-200'
                  }`}
                >
                  <div className={`h-3.5 w-3.5 bg-white rounded-full shadow absolute top-0.5 transition-all duration-205 ${
                    cfg.value ? 'left-4.5' : 'left-0.5'
                  }`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Platform Info card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 border border-slate-200 text-slate-600 shrink-0">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Platform Specifications</h3>
                <p className="text-[10px] text-slate-400 font-semibold">PRISM Enterprise v2.0</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold">
              {[
                ['Database Schema', 'MySQL Ingestion'],
                ['GraphQL Engine', 'Projects v2 (GH API)'],
                ['Sync Intervals', 'On-Demand + Cron'],
                ['Selected Repo', repoLabel ?? 'None'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-0.5">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{k}</p>
                  <p className="text-slate-800 truncate" title={v}>{v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

    </div>
  )
}
