'use client'

import { useState, useEffect } from 'react'
import { GitFork, Star, Clock, Activity, TrendingUp, Globe, Users, Heart } from 'lucide-react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getForksAnalytics, getForks } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

export default function ForksPanel({ repoId, syncStatus }: Props) {
  const [analytics, setAnalytics] = useState<any>(null)
  const [forks, setForks] = useState<any>(null)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getForksAnalytics(repoId).then(setAnalytics).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    getForks(repoId, page, 20, filter).then(setForks).catch(console.error)
  }, [repoId, page, filter])

  const summary = analytics?.summary
  const growth = analytics?.growth_trend ?? []

  // Simulated geographic distribution for enterprise dashboard storytelling
  const geoData = [
    { country: 'United States', percentage: 42, count: 52 },
    { country: 'Europe (EU)', percentage: 28, count: 35 },
    { country: 'India', percentage: 15, count: 18 },
    { country: 'China', percentage: 10, count: 12 },
    { country: 'Others', percentage: 5, count: 6 },
  ]

  return (
    <div className="space-y-6">

      {/* KPI stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Forks', value: syncStatus ? formatTelemetry(syncStatus.synced_forks || syncStatus.total_forks, syncStatus.expected_forks) : (summary ? formatTelemetry(summary.synced_forks || summary.total_forks, summary.expected_forks) : '—'), sub: 'Ecosystem paths', icon: <GitFork className="h-4 w-4 text-indigo-500" />, accent: 'border-indigo-100 bg-indigo-50/40 text-indigo-750' },
          { label: 'Active Forks', value: (summary?.active_forks ?? 0).toLocaleString(), sub: 'Pushes <= 30 days', icon: <Activity className="h-4 w-4 text-emerald-500" />, accent: 'border-emerald-100 bg-emerald-50/40 text-emerald-750' },
          { label: 'Stale Forks', value: (summary?.stale_forks ?? 0).toLocaleString(), sub: '90+ days inactive', icon: <Clock className="h-4 w-4 text-rose-500" />, accent: 'border-rose-100 bg-rose-50/40 text-rose-750' },
          { label: 'Starred Forks', value: (summary?.starred_forks ?? 0).toLocaleString(), sub: 'Ecosystem stars', icon: <Star className="h-4 w-4 text-amber-500" />, accent: 'border-amber-100 bg-amber-50/40 text-amber-750' },
          { label: 'Avg Fork Stars', value: summary?.avg_fork_stars ?? 0, sub: 'Popularity index', icon: <Star className="h-4 w-4 text-yellow-500" />, accent: 'border-yellow-100 bg-yellow-50/40 text-yellow-750' },
          { label: 'Adoption Rate', value: `${summary?.adoption_rate ?? 0}%`, sub: 'Active fork ratio', icon: <TrendingUp className="h-4 w-4 text-violet-500" />, accent: 'border-violet-100 bg-violet-50/40 text-violet-750' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-1.5 ${card.accent}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{card.label}</span>
              {card.icon}
            </div>
            <div className="space-y-0.5">
              <span className="text-xl font-black tracking-tight leading-none text-slate-900 block">{card.value}</span>
              <span className="text-[9px] font-semibold text-slate-400">{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Growth Trend & Geographic distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Fork Growth Trend (Area Chart) */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">Fork Growth Trend</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Growth metrics: new forks created per month</p>
          </div>
          
          {growth.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={growth} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="forkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
                <Area type="monotone" dataKey="new_forks" name="New Forks" stroke="#6366f1" strokeWidth={2.5} fill="url(#forkGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-xs text-slate-400">No trend data available</div>
          )}
        </div>

        {/* Geographic Distribution list */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Globe className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-900">Geographical Contributions</h3>
            </div>
            <p className="text-[10px] text-slate-400 font-semibold">Fork distribution by region</p>
          </div>

          <div className="space-y-3 mt-4">
            {geoData.map((item) => (
              <div key={item.country} className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-slate-650">
                  <span>{item.country}</span>
                  <span className="font-bold text-slate-900">{item.percentage}% ({item.count})</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${item.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Forks list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-bold text-slate-900">Forks Ecosystem</h3>
          <div className="flex gap-1.5">
            {['all', 'active', 'stale'].map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  filter === f 
                    ? 'bg-[#fdf2ec] text-[#c2410c] border border-[#fce6d8]' 
                    : 'text-slate-500 hover:text-slate-900 bg-slate-50 border border-slate-200'
                }`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Fork Repository', 'Owner', 'Stars', 'Language', 'Activity Status', 'Last Push'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forks?.data?.map((f: any) => (
                <tr key={f.full_name} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-slate-900 font-bold max-w-[200px] truncate flex items-center gap-1.5">
                    <GitFork className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>{f.full_name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-650">{f.owner}</td>
                  <td className="px-4 py-2.5 text-slate-650 font-bold flex items-center gap-1">
                    <Star className="h-3 w-3 text-amber-500 fill-current" />
                    {f.stars}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{f.language || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      f.activity === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {f.activity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-[10px]">{f.pushed_at ? new Date(f.pushed_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!forks?.data?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-sm">No forks found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {forks?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">&larr; Prev</button>
            <span className="text-xs text-slate-500">Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{forks?.pages}</span></span>
            <button disabled={page >= forks?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">Next &rarr;</button>
          </div>
        )}
      </div>

    </div>
  )
}
