'use client'
import { useState, useEffect } from 'react'
import { Kanban, CheckCircle2, Circle } from 'lucide-react'
import { motion } from 'framer-motion'
import { getProjectsAnalytics, getProjects } from '@/lib/api'

interface Props { repoId: number }

export default function ProjectsPanel({ repoId }: Props) {
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

  useEffect(() => {
    if (projects?.data) {
      console.log(`[Telemetry][Frontend] Rendered ${projects.data.length} projects`)
    }
  }, [projects])

  return (
    <div className="space-y-6">
      {summary?.total_projects === 0 && !loading && (
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-indigo-300 text-sm">
          No GitHub Projects found for this repository. Projects v2 are fetched via GraphQL when available.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Projects', value: summary?.total_projects ?? 0, icon: <Kanban className="h-4 w-4 text-indigo-300" />, accent: 'bg-indigo-500/10' },
          { label: 'Open', value: summary?.open_projects ?? 0, icon: <Circle className="h-4 w-4 text-emerald-300" />, accent: 'bg-emerald-500/10' },
          { label: 'Closed', value: summary?.closed_projects ?? 0, icon: <CheckCircle2 className="h-4 w-4 text-white/40" />, accent: 'bg-white/5' },
        ].map(({ label, value, icon, accent }) => (
          <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 flex flex-col gap-2">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs font-semibold text-white/60">{label}</p>
          </motion.div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Projects (v2)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects?.data?.map((p: any) => (
            <div key={p.number} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h4 className="text-sm font-semibold text-white/85 line-clamp-2">{p.name}</h4>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${p.state === 'open' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
                  {p.state}
                </span>
              </div>
              <p className="text-[10px] text-white/30 mb-3">by {p.creator ?? 'Unknown'} · {p.project_type}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[['Total', p.items_count ?? 0], ['Open', p.open_items ?? 0], ['Done', p.closed_items ?? 0]].map(([l, v]) => (
                  <div key={String(l)} className="bg-white/[0.04] rounded-lg py-1.5">
                    <p className="text-xs font-bold text-white">{v}</p>
                    <p className="text-[9px] text-white/30">{l}</p>
                  </div>
                ))}
              </div>
              {p.items_count > 0 && (
                <div className="mt-3 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.round((p.closed_items / p.items_count) * 100))}%` }} />
                </div>
              )}
            </div>
          ))}
          {!projects?.data?.length && (
            <div className="col-span-3 py-10 text-center text-white/30 text-sm">No projects found</div>
          )}
        </div>
        {projects?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.04]">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">← Prev</button>
            <span className="text-xs text-white/30">Page {page} of {projects?.pages}</span>
            <button disabled={page >= projects?.pages} onClick={() => setPage(p => p + 1)} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
