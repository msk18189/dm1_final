'use client'

import { Database, RefreshCw, CheckCircle2, XCircle, Info, Clock } from 'lucide-react'
import { motion } from 'framer-motion'

interface SyncStatus {
  sync_status: 'IDLE' | 'SYNCING' | 'COMPLETED' | 'FAILED'
  sync_progress: string | null
  sync_duration: number | null
  initial_sync_completed: boolean
  last_synced_at: string | null
  last_successful_sync: string | null
  error_message: string | null
  total_prs: number
  total_issues: number
  total_branches: number
  total_forks: number
  total_workflow_runs: number
  total_discussions: number
  total_projects: number
  rate_limit_remaining: number | null
  rate_limit_limit: number | null
}

interface Props {
  repoLabel: string
  syncStatus: SyncStatus
  onSync: () => void
  isSyncing: boolean
}

const statusColors = {
  SYNCING: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  COMPLETED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  FAILED: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  IDLE: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
}

function MetricCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] uppercase tracking-wider text-white/30 font-medium">{label}</p>
      <p className="text-base font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

function fmt(iso: string | null): string {
  if (!iso) return 'Never'
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export default function RepositoryStatusPanel({ repoLabel, syncStatus, onSync, isSyncing }: Props) {
  const status = syncStatus.sync_status
  const isBusy = status === 'SYNCING' || isSyncing

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-5"
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
        {/* Left: status */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5 mb-2">
            <Database className="h-4 w-4 text-indigo-400 shrink-0" />
            <h3 className="text-sm font-bold text-white">{repoLabel}</h3>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusColors[status] ?? statusColors.IDLE}`}>
              {status === 'SYNCING' && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
              {status === 'COMPLETED' && <CheckCircle2 className="w-2.5 h-2.5" />}
              {status === 'FAILED' && <XCircle className="w-2.5 h-2.5" />}
              {status === 'IDLE' && <Info className="w-2.5 h-2.5" />}
              {status}
            </span>
            {syncStatus.initial_sync_completed && (
              <span className="text-[10px] bg-white/[0.04] text-white/40 border border-white/[0.06] px-2 py-0.5 rounded-full">
                Initial Sync Complete
              </span>
            )}
          </div>

          {syncStatus.sync_progress && (
            <p className="text-xs text-white/50 mb-3 font-mono leading-relaxed">{syncStatus.sync_progress}</p>
          )}

          {/* Module record counts */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 border-t border-white/[0.04] pt-3">
            <MetricCell label="PRs" value={syncStatus.total_prs ?? 0} />
            <MetricCell label="Issues" value={syncStatus.total_issues ?? 0} />
            <MetricCell label="Branches" value={syncStatus.total_branches ?? 0} />
            <MetricCell label="Forks" value={syncStatus.total_forks ?? 0} />
            <MetricCell label="CI Runs" value={syncStatus.total_workflow_runs ?? 0} />
            <MetricCell label="Discussions" value={syncStatus.total_discussions ?? 0} />
            <MetricCell label="Projects" value={syncStatus.total_projects ?? 0} />
          </div>

          <div className="flex flex-wrap gap-4 mt-3 border-t border-white/[0.04] pt-3">
            <div className="flex items-center gap-1.5 text-xs text-white/35">
              <Clock className="h-3 w-3" />
              <span>Last sync: {fmt(syncStatus.last_successful_sync)}</span>
            </div>
            {syncStatus.rate_limit_remaining !== null && (
              <div className="text-xs text-white/35">
                API budget: {syncStatus.rate_limit_remaining?.toLocaleString()} / {syncStatus.rate_limit_limit?.toLocaleString()}
              </div>
            )}
          </div>

          {status === 'FAILED' && syncStatus.error_message && (
            <div className="mt-3 p-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-300 text-xs">
              <strong>Error:</strong> {syncStatus.error_message}
            </div>
          )}
        </div>

        {/* Right: sync button */}
        <div className="flex flex-col items-start lg:items-end gap-1.5 shrink-0">
          <button
            disabled={isBusy}
            onClick={onSync}
            className="btn-primary rounded-xl px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
            {isBusy ? 'Syncing…' : 'Sync Now'}
          </button>
          <span className="text-[10px] text-white/25 text-right">Full incremental sync</span>
        </div>
      </div>
    </motion.div>
  )
}
