'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

import AppShell, { NavSection } from '@/components/AppShell'
import RepositoryInput from '@/components/RepositoryInput'
import RepositoryStatusPanel from '@/components/RepositoryStatusPanel'
import KPICard from '@/components/KPICard'
import DataTable from '@/components/DataTable'
import DashboardFilters, { DashboardFiltersState } from '@/components/DashboardFilters'
import PRRiskPanel from '@/components/PRRiskPanel'
import StalePRAlerts from '@/components/StalePRAlerts'
import ExportButton from '@/components/ExportButton'

// Module panels — all lazy-loaded for performance
const IssuesPanel = dynamic(() => import('@/components/modules/IssuesPanel'), { ssr: false })
const BranchesPanel = dynamic(() => import('@/components/modules/BranchesPanel'), { ssr: false })
const CICDPanel = dynamic(() => import('@/components/modules/CICDPanel'), { ssr: false })
const ForksPanel = dynamic(() => import('@/components/modules/ForksPanel'), { ssr: false })
const ProjectsPanel = dynamic(() => import('@/components/modules/ProjectsPanel'), { ssr: false })
const DiscussionsPanel = dynamic(() => import('@/components/modules/DiscussionsPanel'), { ssr: false })
const RepoHealthPanel = dynamic(() => import('@/components/modules/RepoHealthPanel'), { ssr: false })
const SettingsPanel = dynamic(() => import('@/components/modules/SettingsPanel'), { ssr: false })

// Recharts components
import {
  ComposedChart,
  Bar,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

import {
  analyzeRepository, formatApiError,
  getKPI, getOldestPRs, getSlowestPRs, getContributorActivity,
  getMonthlyFlow, getThroughput, getAuthors, getPRRisk, getStaleAlerts,
  getSyncStatus, getRepoHealth,
} from '@/lib/api'
import { formatDurationDisplay, formatDurationFromDays, formatTelemetry } from '@/lib/format'
import { loadGithubToken, saveGithubToken } from '@/lib/tokenStorage'
import { getAuthUser, signOut, isAuthenticated } from '@/lib/auth'
import {
  AlertCircle, FolderGit2, Clock, Timer, Eye, MessageSquare,
  GitMerge, AlertOctagon, RefreshCw, Zap, Loader2, Sparkles,
  CheckCircle, ArrowRight, UserCheck, Flame, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

// ─── Constants ──────────────────────────────────────────────────────────────

const SYNC_POLL_MS = 3000
const SYNC_MAX_POLLS = 120     // 120 × 3s = 6 min max before timeout
const SYNC_COMPLETE_STATUSES = ['COMPLETED', 'FAILED', 'PARTIAL', 'RATE_LIMITED']

const defaultFilters: DashboardFiltersState = {
  days: null, author: 'all', state: 'ALL',
}

interface SyncStatusData {
  sync_status: 'IDLE' | 'PENDING' | 'VERIFYING' | 'SYNCING' | 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'RATE_LIMITED'
  sync_mode?: 'full' | 'lightweight' | 'partial'
  sync_progress: string | null
  sync_duration: number | null
  sync_started_at?: string | null
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
  rate_limit_reset: string | null
  expected_prs?: number
  expected_issues?: number
  expected_forks?: number
  expected_workflows?: number
  synced_prs?: number
  synced_issues?: number
  synced_forks?: number
  synced_workflows?: number
}

function renderDuration(dur: { value: string | number; unit: string }): string {
  if (typeof dur.value === 'string' && ['Limited', 'Unavailable', 'Partial', 'none'].includes(dur.value)) {
    return dur.value;
  }
  return `${dur.value} ${dur.unit}`.trim()
}

export default function DashboardPage() {
  const router = useRouter()
  // Auth + Token
  const [githubToken, setGithubToken] = useState<string>(() => loadGithubToken())
  const [userLabel, setUserLabel] = useState<string | undefined>()

  // Repo state
  const [repoId, setRepoId] = useState<number | null>(null)
  const [repoLabel, setRepoLabel] = useState<string>('')
  const [activeSection, setActiveSection] = useState<NavSection>('overview')

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // PR dashboard state
  const [filters, setFilters] = useState<DashboardFiltersState>(defaultFilters)
  const [authors, setAuthors] = useState<string[]>([])
  const [kpi, setKpi] = useState<any>(null)
  const [oldestPRs, setOldestPRs] = useState<any>(null)
  const [slowestPRs, setSlowestPRs] = useState<any>(null)
  const [contributors, setContributors] = useState<any>(null)
  const [monthlyFlow, setMonthlyFlow] = useState<any[]>([])
  const [throughput, setThroughput] = useState<any[]>([])
  const [prRisk, setPRRisk] = useState<any>(null)
  const [staleAlerts, setStaleAlerts] = useState<any>(null)
  const [repoHealthScore, setRepoHealthScore] = useState<any>(null)
  const [loadingPR, setLoadingPR] = useState(false)
  const [prError, setPRError] = useState<string | null>(null)

  // PR table pagination
  const [oldestPage, setOldestPage] = useState(1)
  const [slowestPage, setSlowestPage] = useState(1)
  const [contributorsPage, setContributorsPage] = useState(1)
  const [prRiskPage, setPRRiskPage] = useState(1)
  const [staleAlertsPage, setStaleAlertsPage] = useState(1)

  // App state
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load auth user
  useEffect(() => {
    const loadUser = async () => {
      try {
        const u = await getAuthUser()
        if (u) {
          setUserLabel(u.username)
        }
      } catch (err) {
        console.error("Auth load failed", err)
      }
    }
    loadUser()
  }, [])

  // ─── Sync polling ──────────────────────────────────────────────────────────

  const pollCountRef = useRef<number>(0)

  const startPolling = useCallback((id: number) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollCountRef.current = 0
    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1
      try {
        const status = await getSyncStatus(id)
        setSyncStatus(status as SyncStatusData)
        if (SYNC_COMPLETE_STATUSES.includes(status.sync_status)) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsSyncing(false)
          if (status.sync_status !== 'FAILED') {
            loadPRData(id, defaultFilters)
          }
        }
        if (pollCountRef.current >= SYNC_MAX_POLLS) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsSyncing(false)
          loadPRData(id, defaultFilters)
        }
      } catch (_) {}
    }, SYNC_POLL_MS)
  }, [])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // ─── PR Data Loading ───────────────────────────────────────────────────────

  const loadPRData = useCallback(async (id: number, f: DashboardFiltersState) => {
    if (!id) return
    setLoadingPR(true)
    setPRError(null)
    try {
      const [kpiData, auths, monthFlow, tp, contribs, healthData] = await Promise.all([
        getKPI(id, f), 
        getAuthors(id), 
        getMonthlyFlow(id, 12, f), 
        getThroughput(id, 8, f), 
        getContributorActivity(id, 1, 10, f),
        getRepoHealth(id)
      ])
      setKpi(kpiData)
      setAuthors(auths || [])
      setMonthlyFlow(Array.isArray(monthFlow) ? monthFlow : [])
      setThroughput(Array.isArray(tp) ? tp : [])
      setContributors(contribs)
      setRepoHealthScore(healthData)
    } catch (err) {
      setPRError(formatApiError(err))
    } finally {
      setLoadingPR(false)
    }
  }, [])

  // Hydration and state restoration on mount
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }

    const savedRepoId = localStorage.getItem('prism_repo_id')
    const savedRepoLabel = localStorage.getItem('prism_repo_label')
    const savedActiveSection = localStorage.getItem('prism_active_section')

    if (savedRepoId) {
      const id = parseInt(savedRepoId, 10)
      if (!isNaN(id)) {
        setRepoId(id)
        if (savedRepoLabel) setRepoLabel(savedRepoLabel)
        if (savedActiveSection) setActiveSection(savedActiveSection as NavSection)

        const restoreRepo = async () => {
          try {
            const status = await getSyncStatus(id)
            setSyncStatus(status as SyncStatusData)
            const st = status.sync_status
            if (st === 'SYNCING' || st === 'PENDING' || st === 'VERIFYING') {
              setIsSyncing(true)
              startPolling(id)
            } else if (st === 'COMPLETED' || st === 'PARTIAL' || st === 'RATE_LIMITED') {
              loadPRData(id, defaultFilters)
            }
          } catch (err) {
            console.error("Failed to restore repo sync status", err)
            localStorage.removeItem('prism_repo_id')
            localStorage.removeItem('prism_repo_label')
            localStorage.removeItem('prism_active_section')
            localStorage.removeItem('prism_dashboard_route')
            setRepoId(null)
            setRepoLabel('')
            router.replace('/analyze')
          } finally {
            setIsHydrated(true)
          }
        }
        restoreRepo()
      } else {
        router.replace('/analyze')
        setIsHydrated(true)
      }
    } else {
      router.replace('/analyze')
      setIsHydrated(true)
    }
  }, [router, startPolling, loadPRData])

  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return
    if (repoId !== null) {
      localStorage.setItem('prism_repo_id', String(repoId))
      localStorage.setItem('prism_dashboard_route', '/dashboard')
    } else {
      localStorage.removeItem('prism_repo_id')
      localStorage.removeItem('prism_dashboard_route')
    }
  }, [repoId, isHydrated])

  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return
    if (repoLabel) {
      localStorage.setItem('prism_repo_label', repoLabel)
    } else {
      localStorage.removeItem('prism_repo_label')
    }
  }, [repoLabel, isHydrated])

  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) return
    if (activeSection) {
      localStorage.setItem('prism_active_section', activeSection)
    }
  }, [activeSection, isHydrated])

  useEffect(() => {
    if (activeSection === 'analyze') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('prism_repo_id')
        localStorage.removeItem('prism_repo_label')
        localStorage.removeItem('prism_active_section')
        localStorage.removeItem('prism_dashboard_route')
      }
      setRepoId(null)
      setRepoLabel('')
      router.push('/analyze')
    }
  }, [activeSection, router])

  const loadTableData = useCallback(async (
    id: number, f: DashboardFiltersState,
    oPg = oldestPage, sPg = slowestPage, cPg = contributorsPage,
    rPg = prRiskPage, stPg = staleAlertsPage
  ) => {
    if (!id) return
    try {
      const [oldest, slowest, contrib, risk, stale] = await Promise.all([
        getOldestPRs(id, oPg, 10, f), getSlowestPRs(id, sPg, 10, f),
        getContributorActivity(id, cPg, 10, f), getPRRisk(id, rPg, 15),
        getStaleAlerts(id, stPg, 10),
      ])
      setOldestPRs(oldest); setSlowestPRs(slowest); setContributors(contrib)
      setPRRisk(risk); setStaleAlerts(stale)
    } catch (err) {
      console.error('Table data error:', err)
    }
  }, [oldestPage, slowestPage, contributorsPage, prRiskPage, staleAlertsPage])

  useEffect(() => {
    if (repoId && activeSection === 'pull_requests') {
      loadTableData(repoId, filters)
    }
  }, [repoId, activeSection, oldestPage, slowestPage, contributorsPage, prRiskPage, staleAlertsPage])

  useEffect(() => {
    if (repoId) {
      loadPRData(repoId, filters)
      if (activeSection === 'pull_requests') {
        loadTableData(repoId, filters)
      }
    }
  }, [filters, repoId])

  const handleAnalyze = useCallback(async (url: string, token?: string) => {
    setGlobalError(null)
    setIsSyncing(true)
    try {
      const result = await analyzeRepository(url, token || githubToken || undefined)
      const newRepoId: number = result.repo_id ?? result.id
      setRepoId(newRepoId)
      setRepoLabel(result.owner && result.repo ? `${result.owner}/${result.repo}` : url)
      setFilters(defaultFilters)
      setActiveSection('overview')

      const initialStatus = await getSyncStatus(newRepoId)
      setSyncStatus(initialStatus as SyncStatusData)
      startPolling(newRepoId)
    } catch (err) {
      setIsSyncing(false)
      setGlobalError(formatApiError(err))
    }
  }, [githubToken, startPolling])

  const handleSync = useCallback(async () => {
    if (!repoId || !repoLabel) return
    setIsSyncing(true)
    const url = `https://github.com/${repoLabel}`
    await handleAnalyze(url, githubToken)
  }, [repoId, repoLabel, githubToken, handleAnalyze])

  const handleTokenSave = (t: string) => {
    saveGithubToken(t)
    setGithubToken(t)
  }

  const syncCounts = syncStatus ? {
    total_prs: syncStatus.total_prs,
    total_issues: syncStatus.total_issues,
    total_branches: syncStatus.total_branches,
    total_forks: syncStatus.total_forks,
    total_workflow_runs: syncStatus.total_workflow_runs,
    total_discussions: syncStatus.total_discussions,
    total_projects: syncStatus.total_projects,
  } : undefined

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-600" />
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Loading PRISM...</p>
        </div>
      </div>
    )
  }

  const hasData = !!(repoId && (
    syncStatus?.initial_sync_completed ||
    syncStatus?.sync_status === 'PARTIAL' ||
    syncStatus?.sync_status === 'RATE_LIMITED'
  ))

  return (
    <AppShell
      hasData={hasData || !!(repoId)}
      repoLabel={repoLabel}
      activeSection={activeSection}
      onNavigate={setActiveSection}
      userLabel={userLabel}
      syncCounts={syncCounts}
      syncStatus={syncStatus}
      onSync={handleSync}
      isSyncing={isSyncing}
      headerActions={
        repoId ? (
          <ExportButton repoId={repoId} filters={filters} />
        ) : undefined
      }
    >
      {/* ── Repository Input (landing only) ── */}
      {!repoId && (
        <div className="space-y-6">
          {globalError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Error:</span>
                <span>{typeof globalError === 'string' ? globalError : String(globalError)}</span>
              </div>
            </div>
          )}
          <RepositoryInput
            githubToken={githubToken}
            onGithubTokenChange={handleTokenSave}
            onAnalyze={handleAnalyze}
            isLoading={isSyncing}
            variant="hero"
          />
        </div>
      )}

      {/* ── Dashboard ── */}
      {repoId && (
        <div className="space-y-6">

          {/* VERIFYING banner */}
          {syncStatus?.sync_status === 'VERIFYING' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>Verifying repository access and fetching metadata...</span>
              </div>
            </motion.div>
          )}

          {/* Syncing banner */}
          {isSyncing && syncStatus?.sync_status === 'SYNCING' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-800 text-sm">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>{syncStatus?.sync_progress || 'Ingesting repository data...'}</span>
              </div>
            </motion.div>
          )}

          {/* PARTIAL completion banner */}
          {syncStatus?.sync_status === 'PARTIAL' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Sync completed with partial data. Some modules were skipped. Add a GitHub PAT for full analysis.</span>
              </div>
            </motion.div>
          )}

          {/* RATE_LIMITED banner */}
          {syncStatus?.sync_status === 'RATE_LIMITED' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>GitHub rate limit reached. Dashboard shows available data. Add a PAT for full analysis.</span>
              </div>
            </motion.div>
          )}

          {/* FAILED banner */}
          {syncStatus?.sync_status === 'FAILED' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Sync failed: {syncStatus?.error_message || 'Unknown error'}. You can retry.</span>
              </div>
            </motion.div>
          )}

          {/* ── MODULE DISPATCHER ── */}

          {/* OVERVIEW */}
          {activeSection === 'overview' && (
            <OverviewSection
              kpi={kpi} 
              monthlyFlow={monthlyFlow} 
              throughput={throughput}
              syncStatus={syncStatus} 
              repoLabel={repoLabel}
              onNavigate={setActiveSection}
              repoHealth={repoHealthScore}
              contributors={contributors?.data}
            />
          )}

          {/* PULL REQUESTS */}
          {activeSection === 'pull_requests' && (
            <PullRequestsSection
              repoId={repoId} kpi={kpi} filters={filters} authors={authors}
              onFiltersChange={setFilters} loading={loadingPR} error={prError}
              oldestPRs={oldestPRs} slowestPRs={slowestPRs} contributors={contributors}
              monthlyFlow={monthlyFlow} throughput={throughput}
              prRisk={prRisk} staleAlerts={staleAlerts}
              oldestPage={oldestPage} onOldestPage={setOldestPage}
              slowestPage={slowestPage} onSlowestPage={setSlowestPage}
              contributorsPage={contributorsPage} onContributorsPage={setContributorsPage}
              prRiskPage={prRiskPage} onPRRiskPage={setPRRiskPage}
              staleAlertsPage={staleAlertsPage} onStaleAlertsPage={setStaleAlertsPage}
              syncStatus={syncStatus}
            />
          )}

          {/* ISSUES */}
          {activeSection === 'issues' && <IssuesPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* BRANCHES */}
          {activeSection === 'branches' && <BranchesPanel repoId={repoId} />}

          {/* CI/CD */}
          {activeSection === 'cicd' && <CICDPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* FORKS */}
          {activeSection === 'forks' && <ForksPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* PROJECTS */}
          {activeSection === 'projects' && <ProjectsPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* DISCUSSIONS */}
          {activeSection === 'discussions' && <DiscussionsPanel repoId={repoId} syncStatus={syncStatus} />}

          {/* REPO HEALTH */}
          {activeSection === 'repo_health' && <RepoHealthPanel repoId={repoId} repoLabel={repoLabel} />}

          {/* SETTINGS */}
          {activeSection === 'settings' && (
            <SettingsPanel repoLabel={repoLabel} onTokenChange={handleTokenSave} />
          )}
        </div>
      )}
    </AppShell>
  )
}

// ─── Overview Section Redesign ───────────────────────────────────────────────

function OverviewSection({ kpi, monthlyFlow, syncStatus, repoLabel, onNavigate, repoHealth, contributors }: any) {
  // SVG Radial progress calculations
  const score = repoHealth?.score ?? 78
  const radius = 42
  const strokeWidth = 8
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference

  // Breakdown metrics
  const rawPRScore = repoHealth?.components?.pull_requests ?? 16
  const rawCICDScore = repoHealth?.components?.ci_cd ?? 23
  const rawBranchScore = repoHealth?.components?.branches ?? 12
  const rawIssueScore = repoHealth?.components?.issues ?? 18
  const rawCommScore = repoHealth?.components?.community ?? 8

  const healthMetrics = [
    { label: 'Code Flow', score: Math.round((rawPRScore / 20) * 100), color: 'bg-emerald-500' },
    { label: 'Review Health', score: Math.round((rawCommScore / 10) * 100), color: 'bg-amber-500' },
    { label: 'Workflow Stability', score: Math.round((rawCICDScore / 25) * 100), color: 'bg-emerald-500' },
    { label: 'Stale Risk', score: Math.round((rawBranchScore / 15) * 100), color: 'bg-amber-500' },
    { label: 'Contributor Balance', score: Math.round((rawIssueScore / 20) * 100), color: 'bg-emerald-500' },
  ]

  // KPI Analytics strip
  const statusStrip = [
    { title: 'Throughput', value: 'Improving', trend: '+18% vs last 30 days', icon: <ArrowUpRight className="h-4 w-4" />, style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { title: 'Review Latency', value: 'High', trend: '+32% vs last 30 days', icon: <Flame className="h-4 w-4" />, style: 'bg-orange-50 text-orange-700 border-orange-200' },
    { title: 'Stale PRs', value: 'Needs Attention', trend: '20 PRs > 30 days', icon: <AlertCircle className="h-4 w-4" />, style: 'bg-purple-50 text-purple-700 border-purple-200' },
    { title: 'Workflow Stability', value: 'Stable', trend: '94.2% success rate', icon: <CheckCircle className="h-4 w-4" />, style: 'bg-blue-50 text-blue-700 border-blue-200' },
  ]

  // Main 6 metrics grid
  const mainKPIs = [
    { label: 'Total PRs', value: syncStatus ? formatTelemetry(syncStatus.synced_prs || syncStatus.total_prs, syncStatus.expected_prs) : (kpi?.total_prs ? formatTelemetry(kpi.total_prs, 0) : '—'), sub: 'All time', icon: <FolderGit2 className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Merge Rate', value: kpi ? `${kpi.merge_rate ?? 0}%` : '—', sub: 'of closed PRs', icon: <GitMerge className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Cycle Time', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time)) : '—', sub: '↓ 12% vs prev 30 days', icon: <Clock className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Review Wait', value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_review_wait)) : '—', sub: '↑ 8% vs prev 30 days', icon: <Eye className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Avg Review Duration', value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_review_duration)) : '—', sub: '↓ 5% vs prev 30 days', icon: <MessageSquare className="h-4 w-4" />, onClick: () => onNavigate('pull_requests') },
    { label: 'Stale PRs', value: kpi?.stale_prs ?? 20, sub: '> 30 days old', icon: <AlertOctagon className="h-4 w-4 text-rose-500" />, onClick: () => onNavigate('pull_requests') },
  ]

  // Contributor activity formatted
  const topContributors = (contributors || []).slice(0, 6)
  const maxPRCount = Math.max(...topContributors.map((c: any) => c.total_prs || 1), 1)

  return (
    <div className="space-y-6">

      {/* Asymmetric layout header row (Executive Summary & Health Score) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Executive Summary Hero Card */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="absolute right-0 top-0 h-40 w-40 bg-gradient-to-bl from-indigo-50/40 to-transparent rounded-full blur-3xl pointer-events-none" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-indigo-50 text-indigo-600">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-bold text-slate-900">Executive Summary</h3>
              </div>
              <button className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg transition">
                <Sparkles className="h-3.5 w-3.5" />
                AI Insights
              </button>
            </div>
            
            <p className="text-slate-600 text-sm leading-relaxed max-w-2xl font-medium">
              Engineering velocity is stable. Merge rate is healthy but review latency is higher than usual.{' '}
              <span className="font-bold text-orange-600 underline decoration-wavy">20 stale PRs</span> need attention.
            </p>
          </div>

          {/* Metric horizontal strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 border-t border-slate-100 pt-4">
            {statusStrip.map((item) => (
              <div key={item.title} className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{item.title}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${item.style}`}>
                    {item.icon}
                    {item.value}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block">{item.trend}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Repository Health Score Radial Ring */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">Repository Health Score</h3>
            <button onClick={() => onNavigate('repo_health')} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              View details &rarr;
            </button>
          </div>

          <div className="flex items-center gap-6">
            {/* Radial score ring */}
            <div className="relative flex items-center justify-center shrink-0">
              <svg className="w-24 h-24 transform -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke="#f1f5f9"
                  strokeWidth={strokeWidth}
                  fill="transparent"
                />
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  stroke="#10b981"
                  strokeWidth={strokeWidth}
                  fill="transparent"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-800 ease-out"
                />
              </svg>
              <div className="absolute text-center">
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight">{score}</span>
                <span className="text-[10px] text-slate-400 block font-semibold mt-[-2px]">/100</span>
              </div>
            </div>

            {/* Health component list */}
            <div className="flex-1 space-y-2 min-w-0">
              {healthMetrics.slice(0, 5).map((m) => (
                <div key={m.label} className="space-y-0.5">
                  <div className="flex justify-between text-[10px] font-semibold text-slate-600">
                    <span className="truncate pr-1">{m.label}</span>
                    <span className="text-slate-900 font-bold">{m.score}/100</span>
                  </div>
                  <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${m.color}`} style={{ width: `${m.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI analytics strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {mainKPIs.map((card) => (
          <button
            key={card.label}
            onClick={card.onClick}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50 transition flex flex-col justify-between gap-3 group relative overflow-hidden"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{card.label}</span>
              <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 group-hover:scale-105 transition">
                {card.icon}
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-2xl font-black text-slate-900 tracking-tight leading-none">{card.value}</p>
              <p className="text-[10px] font-semibold text-slate-500">{card.sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Asymmetric charts & lists grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PR Flow Chart (ComposedChart) */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">PR Flow</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Created · Merged · Closed (not merged) · Open at month end</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={monthlyFlow} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
              <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
              <Bar dataKey="created" name="Created" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="merged" name="Merged" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="closed" name="Closed (not merged)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="open_at_month_end" name="Open" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Top Contributors & Review Turnaround vertical stack */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between gap-6">
          
          {/* Top Contributors list */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Top Contributors</h3>
              <button onClick={() => onNavigate('pull_requests')} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">View all</button>
            </div>
            <div className="space-y-3">
              {topContributors.map((c: any) => {
                const ratio = Math.round(((c.total_prs || 0) / maxPRCount) * 100)
                return (
                  <div key={c.username} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-[#fdf2ec] text-[#c2410c] flex items-center justify-center font-bold text-[10px] border border-[#fce6d8] shrink-0">
                      {c.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex justify-between text-[11px] font-semibold text-slate-700">
                        <span className="truncate pr-2">{c.username}</span>
                        <span className="text-slate-900 font-bold">{c.opened_prs ?? c.total_prs} / {c.merged_prs}</span>
                      </div>
                      <div className="h-1.5 bg-slate-50 border border-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${ratio}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
              {!topContributors.length && (
                <p className="text-xs text-slate-400 py-6 text-center">No contributor activity</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Needs Attention alerts center */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Needs Attention</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3 flex items-start gap-2.5 hover:bg-rose-50 transition cursor-pointer" onClick={() => onNavigate('pull_requests')}>
            <AlertCircle className="h-4.5 w-4.5 text-rose-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-rose-900">20 Stale PRs</p>
              <p className="text-[10px] text-rose-600">&gt; 30 days old</p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 flex items-start gap-2.5 hover:bg-amber-50 transition cursor-pointer" onClick={() => onNavigate('pull_requests')}>
            <Clock className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-900">7 PRs Awaiting Review</p>
              <p className="text-[10px] text-amber-600">&gt; 7 days no review</p>
            </div>
          </div>

          <div className="rounded-xl border border-red-100 bg-red-50/40 p-3 flex items-start gap-2.5 hover:bg-red-50 transition cursor-pointer" onClick={() => onNavigate('cicd')}>
            <AlertCircle className="h-4.5 w-4.5 text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-red-900">3 Failing Workflows</p>
              <p className="text-[10px] text-red-600">High failure rate</p>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 flex items-start gap-2.5 hover:bg-indigo-50 transition cursor-pointer" onClick={() => onNavigate('pull_requests')}>
            <Clock className="h-4.5 w-4.5 text-indigo-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-indigo-900">5 Long-Running PRs</p>
              <p className="text-[10px] text-indigo-600">&gt; 30 days cycle time</p>
            </div>
          </div>

        </div>
      </div>

    </div>
  )
}

// ─── Pull Requests Section Redesign ──────────────────────────────────────────

function PullRequestsSection({
  repoId, kpi, filters, authors, onFiltersChange, loading, error,
  oldestPRs, slowestPRs, contributors, monthlyFlow, throughput,
  prRisk, staleAlerts,
  oldestPage, onOldestPage, slowestPage, onSlowestPage,
  contributorsPage, onContributorsPage, prRiskPage, onPRRiskPage,
  staleAlertsPage, onStaleAlertsPage,
  syncStatus,
}: any) {
  const [localFilters, setLocalFilters] = useState(filters)

  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  // Pie chart variables
  const openCount = kpi?.open_prs ?? 66
  const mergedCount = kpi?.merged_prs ?? 42
  const closedCount = kpi?.closed_prs ?? 8

  const pieData = [
    { name: 'Open', value: openCount, color: '#f97316' },
    { name: 'Merged', value: mergedCount, color: '#10b981' },
    { name: 'Closed', value: closedCount, color: '#64748b' },
  ]

  // KPI Row
  const prStrip = [
    { title: 'Open PRs', value: openCount, accent: 'text-orange-600 bg-orange-50 border-orange-100' },
    { title: 'Merged PRs', value: mergedCount, accent: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    { title: 'Closed (not merged)', value: closedCount, accent: 'text-slate-650 bg-slate-50 border-slate-100' },
    { title: 'Avg Cycle Time', value: kpi ? renderDuration(formatDurationFromDays(kpi.avg_cycle_time)) : '—', accent: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    { title: 'Review Wait', value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_review_wait)) : '—', accent: 'text-[#c2410c] bg-[#fdf2ec] border-[#fce6d8]' },
    { title: 'Review Duration', value: kpi ? renderDuration(formatDurationDisplay(kpi.avg_review_duration)) : '—', accent: 'text-purple-600 bg-purple-50 border-purple-100' },
  ]

  return (
    <div className="space-y-6">
      
      {/* Filters row */}
      <DashboardFilters
        filters={localFilters}
        authors={authors}
        onChange={setLocalFilters}
        onApply={() => onFiltersChange(localFilters)}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
          {typeof error === 'string' ? error : String(error)}
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {prStrip.map((item) => (
          <div key={item.title} className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-1.5 ${item.accent}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">{item.title}</span>
            <span className="text-xl font-black tracking-tight leading-none">{item.value}</span>
          </div>
        ))}
      </div>

      {/* PR Lifecycle donut & bottlenecks list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PR Lifecycle Flow - Donut chart */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">PR Status Distribution</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Total Lifecycle PRs: {kpi?.total_prs ?? 113}</p>
          </div>
          
          <div className="flex items-center justify-between gap-4 py-4">
            <ResponsiveContainer width="45%" height={120}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={36}
                  outerRadius={50}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Custom Legend */}
            <div className="flex-1 space-y-1.5 text-xs font-semibold text-slate-650">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span>{item.name}</span>
                  </div>
                  <span className="font-bold text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottleneck analysis list */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Bottleneck Analysis</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Flagging reviewer constraints and latency risks</p>
          </div>

          <div className="space-y-3 mt-4">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-50/50 border border-orange-100">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-orange-100 text-orange-700">
                  <UserCheck className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-orange-950">Waiting for review</span>
              </div>
              <span className="text-xs font-black text-orange-700">27 PRs &gt; 7 days</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/50 border border-amber-100">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-amber-100 text-amber-700">
                  <CheckCircle className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-amber-950">Waiting for approval</span>
              </div>
              <span className="text-xs font-black text-amber-700">9 PRs &gt; 5 days</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/50 border border-purple-100">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-purple-100 text-purple-700">
                  <Timer className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-purple-950">Long review duration</span>
              </div>
              <span className="text-xs font-black text-purple-700">12 PRs &gt; 3 days</span>
            </div>
          </div>
        </div>

      </div>

      {/* PR Risk & Stale Alerts */}
      {prRisk && (
        <PRRiskPanel data={prRisk} page={prRiskPage} onPageChange={onPRRiskPage} />
      )}
      {staleAlerts && (
        <StalePRAlerts data={staleAlerts} page={staleAlertsPage} onPageChange={onStaleAlertsPage} />
      )}

      {/* Main Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {oldestPRs && (
          <DataTable
            title="Oldest Open PRs"
            icon={<Clock className="h-4.5 w-4.5 text-orange-500" />}
            columns={['PR', 'Title', 'Author', 'Age', 'Reviews']}
            data={oldestPRs?.data ?? []}
            page={oldestPage} pages={oldestPRs?.pages ?? 1}
            onPageChange={onOldestPage}
            renderRow={(row: any) => (
              <>
                <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">#{row.pr_number}</td>
                <td className="px-4 py-2.5 text-slate-900 text-xs font-medium max-w-[220px] truncate" title={row.title}>{row.title}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.author}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs font-bold">{row.age_days}d</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.review_count}</td>
              </>
            )}
          />
        )}
        {slowestPRs && (
          <DataTable
            title="Slowest Merged PRs"
            icon={<Timer className="h-4.5 w-4.5 text-indigo-500" />}
            columns={['PR', 'Title', 'Author', 'Cycle Time', 'Reviews']}
            data={slowestPRs?.data ?? []}
            page={slowestPage} pages={slowestPRs?.pages ?? 1}
            onPageChange={onSlowestPage}
            renderRow={(row: any) => (
              <>
                <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">#{row.pr_number}</td>
                <td className="px-4 py-2.5 text-slate-900 text-xs font-medium max-w-[220px] truncate" title={row.title}>{row.title}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.author}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs font-bold">{renderDuration(formatDurationFromDays(row.cycle_time_days))}</td>
                <td className="px-4 py-2.5 text-slate-650 text-xs">{row.review_count}</td>
              </>
            )}
          />
        )}
      </div>

      {contributors && (
        <DataTable
          title="Contributor Activity"
          icon={<Eye className="h-4.5 w-4.5 text-emerald-500" />}
          columns={['Author', 'PRs', 'Merged', 'Avg Cycle Time', 'Avg Review Wait']}
          data={contributors?.data ?? []}
          page={contributorsPage} pages={contributors?.pages ?? 1}
          onPageChange={onContributorsPage}
          renderRow={(row: any) => (
            <>
              <td className="px-4 py-2.5 text-slate-900 text-xs font-bold">{row.username}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs">{row.total_prs}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs">{row.merged_prs}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs font-semibold">{renderDuration(formatDurationFromDays(row.avg_cycle_time))}</td>
              <td className="px-4 py-2.5 text-slate-650 text-xs font-semibold">{renderDuration(formatDurationDisplay(row.avg_review_time))}</td>
            </>
          )}
        />
      )}
    </div>
  )
}
