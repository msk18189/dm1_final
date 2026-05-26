'use client'

import { useState, useEffect } from 'react'
import { Kanban, CheckCircle2, Circle, Clock, AlertCircle, TrendingUp, Calendar, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { getProjectsAnalytics, getProjects } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

export default function ProjectsPanel({ repoId, syncStatus }: Props) {
  const [summary, setSummary] = useState<any>(null)
  const [projects, setProjects] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getProjectsAnalytics(repoId).then(setSummary).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    getProjects(repoId, page).then(setProjects).catch(console.error)
  }, [repoId, page])

  // Simulated milestones data for strategic planning dashboard feel
  const milestones = [
    { title: 'v2.0 Release', progress: 75, due: 'In 9 days', risk: 'Low', riskStyle: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    { title: 'Model Inference Optimization', progress: 60, due: 'In 12 days', risk: 'Medium', riskStyle: 'text-amber-600 bg-amber-50 border-amber-100' },
    { title: 'Documentation Revamp', progress: 90, due: 'In 2 days', risk: 'Low', riskStyle: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    { title: 'Benchmark Suite', progress: 20, due: 'Overdue (3d ago)', risk: 'High', riskStyle: 'text-rose-600 bg-rose-50 border-rose-100' },
    { title: 'Training Pipeline Refactor', progress: 45, due: 'In 24 days', risk: 'Low', riskStyle: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  ]

  return (
    <div className="space-y-6">

      {summary?.total_projects === 0 && !loading && (
        <div className="rounded-2xl border border-slate-200 bg-indigo-50/50 p-5 text-slate-800 text-sm">
          No GitHub Projects found for this repository
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Projects', value: syncStatus ? formatTelemetry(syncStatus.total_projects, 0) : (summary ? formatTelemetry(summary.total_projects, 0) : '—'), sub: 'Project boards', icon: <Kanban className="h-4 w-4 text-indigo-500" />, accent: 'border-indigo-100 bg-indigo-50/40 text-indigo-750' },
          { label: 'Open Boards', value: summary?.open_projects ?? 0, sub: 'Active planning', icon: <Circle className="h-4 w-4 text-emerald-500" />, accent: 'border-emerald-100 bg-emerald-50/40 text-emerald-750' },
          { label: 'Closed Boards', value: summary?.closed_projects ?? 0, sub: 'Archived boards', icon: <CheckCircle2 className="h-4 w-4 text-slate-400" />, accent: 'border-slate-200 bg-slate-50/40 text-slate-500' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 shadow-sm flex items-center justify-between gap-3 ${card.accent}`}>
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">{card.label}</span>
              <span className="text-2xl font-black tracking-tight leading-none text-slate-900 block">{card.value}</span>
              <span className="text-[9px] font-semibold text-slate-400 block">{card.sub}</span>
            </div>
            <div className="p-2 bg-white rounded-lg border border-slate-100 shadow-sm shrink-0">
              {card.icon}
            </div>
          </div>
        ))}
      </div>

      {/* Main layout grid (Projects list & Milestones) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Projects list */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Active Projects</h3>
          <p className="text-[10px] text-slate-400 font-semibold mb-4">Board progress tracking and task status</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {projects?.data?.map((p: any) => (
              <div key={p.number} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-900 line-clamp-1" title={p.name}>{p.name}</h4>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-bold border ${
                      p.state === 'open' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-500'
                    }`}>
                      {p.state}
                    </span>
                  </div>
                  <p className="text-[9px] font-semibold text-slate-400">by {p.creator ?? 'System'} · {p.project_type}</p>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  {[['Total', p.items_count ?? 0], ['Open', p.open_items ?? 0], ['Done', p.closed_items ?? 0]].map(([l, v]) => (
                    <div key={String(l)} className="bg-white border border-slate-200/80 rounded-lg py-1">
                      <p className="font-bold text-slate-900">{v}</p>
                      <p className="text-[8px] font-bold text-slate-400 uppercase">{l}</p>
                    </div>
                  ))}
                </div>

                {p.items_count > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[9px] font-semibold text-slate-500">
                      <span>Completion Rate</span>
                      <span className="font-bold text-slate-800">{Math.round((p.closed_items / p.items_count) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 border border-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.round((p.closed_items / p.items_count) * 100))}%` }} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!projects?.data?.length && (
              <div className="col-span-2 py-10 text-center text-slate-400 text-xs font-semibold">No active projects found</div>
            )}
          </div>

          {projects?.pages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">&larr; Prev</button>
              <span className="text-xs text-slate-500">Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{projects?.pages}</span></span>
              <button disabled={page >= projects?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">Next &rarr;</button>
            </div>
          )}
        </div>

        {/* Milestone analytics */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Sprint Milestones</h3>
            <p className="text-[10px] text-slate-400 font-semibold mb-4">Milestone forecast & timeline tracking</p>
          </div>

          <div className="space-y-4">
            {milestones.map((m) => (
              <div key={m.title} className="space-y-1.5">
                <div className="flex items-start justify-between gap-2 text-[11px] font-semibold text-slate-700">
                  <span className="truncate pr-1 leading-tight">{m.title}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-bold border ${m.riskStyle}`}>
                    {m.risk} Risk
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${m.progress}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-900 w-8 text-right">{m.progress}%</span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold">
                  <Calendar className="h-3 w-3" />
                  <span>{m.due}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  )
}
