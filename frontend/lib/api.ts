import axios, { isAxiosError } from 'axios'
import type { DashboardFiltersState } from '@/components/DashboardFilters'

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

function filterParams(filters?: DashboardFiltersState) {
  if (!filters) return {}
  const params: Record<string, string | number> = {}
  if (filters.days) params.days = filters.days
  if (filters.author && filters.author !== 'all') params.author = filters.author
  if (filters.state && filters.state !== 'ALL') params.state = filters.state
  if (filters.startDate) params.start_date = filters.startDate
  if (filters.endDate) params.end_date = filters.endDate
  return params
}

export function formatApiError(err: unknown): string {
  if (!isAxiosError(err)) {
    return err instanceof Error ? err.message : 'Failed to analyze repository'
  }
  if (err.code === 'ERR_NETWORK') {
    return `Cannot reach the API at ${API_BASE}. Start the backend with: cd backend && python main.py`
  }
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d) => d.msg || d.message || String(d)).join(', ')
  return err.message || 'Failed to analyze repository'
}

// ─── Repository Management ────────────────────────────────────────────────

export const verifyRepositoryAccess = async (url: string, githubToken?: string) => {
  const response = await api.post('/api/verify-repo', { url, github_token: githubToken || null })
  return response.data as {
    ok: boolean; owner: string; repo: string; is_private: boolean
    url?: string; has_token: boolean; token_source: 'user' | 'env' | 'none'
    stars?: number; language?: string; description?: string
  }
}

export const analyzeRepository = async (url: string, githubToken?: string) => {
  const response = await api.post('/api/analyze', { url, github_token: githubToken || null })
  return response.data
}

export const getSyncStatus = async (repoId: number) => {
  const response = await api.get(`/api/sync-status/${repoId}`)
  return response.data as {
    id: number; owner: string; name: string; full_name: string
    sync_status: 'IDLE' | 'SYNCING' | 'COMPLETED' | 'FAILED'
    sync_progress: string | null; sync_duration: number | null
    initial_sync_completed: boolean
    last_synced_at: string | null; last_successful_sync: string | null
    error_message: string | null
    total_prs: number; total_issues: number; total_branches: number
    total_forks: number; total_workflow_runs: number; total_discussions: number
    rate_limit_remaining: number | null; rate_limit_limit: number | null; rate_limit_reset: string | null
  }
}

export interface AnalyzedRepo {
  id: number; owner: string; name: string; full_name: string; url: string
  description?: string; language?: string; stars?: number; visibility?: string
  sync_status?: string; initial_sync_completed?: boolean; last_synced_at?: string
  total_prs?: number; total_issues?: number; total_branches?: number
  total_forks?: number; total_workflow_runs?: number; total_discussions?: number
}

export async function getRepositories(): Promise<AnalyzedRepo[]> {
  const response = await api.get('/api/repositories')
  return response.data
}

// ─── Module 1: Pull Requests ──────────────────────────────────────────────

export const getKPI = async (repoId: number, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/kpi/${repoId}`, { params: filterParams(filters) })
  return response.data
}

export const getOldestPRs = async (repoId: number, page = 1, limit = 10, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/oldest-prs/${repoId}`, { params: { page, limit, ...filterParams(filters) } })
  return response.data
}

export const getSlowestPRs = async (repoId: number, page = 1, limit = 10, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/slowest-prs/${repoId}`, { params: { page, limit, ...filterParams(filters) } })
  return response.data
}

export const getContributorActivity = async (repoId: number, page = 1, limit = 10, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/contributor-activity/${repoId}`, { params: { page, limit, ...filterParams(filters) } })
  return response.data
}

export const getMonthlyFlow = async (repoId: number, months = 6, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/monthly-flow/${repoId}`, { params: { months, ...filterParams(filters) } })
  return response.data
}

export const getThroughput = async (repoId: number, weeks = 8, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/throughput/${repoId}`, { params: { weeks, ...filterParams(filters) } })
  return response.data
}

export const getAuthors = async (repoId: number) => {
  const response = await api.get(`/api/authors/${repoId}`)
  return response.data.authors as string[]
}

export const getPRRisk = async (repoId: number, page = 1, limit = 15) => {
  const response = await api.get(`/api/pr-risk/${repoId}`, { params: { page, limit } })
  return response.data
}

export const getStaleAlerts = async (repoId: number, page = 1, limit = 10) => {
  const response = await api.get(`/api/stale-alerts/${repoId}`, { params: { page, limit } })
  return response.data
}

// ─── Module 2: Issues ────────────────────────────────────────────────────

export const getIssues = async (repoId: number, page = 1, limit = 20, state = 'all', label?: string) => {
  const response = await api.get(`/api/issues/${repoId}`, { params: { page, limit, state, label } })
  return response.data
}

export const getIssuesAnalytics = async (repoId: number) => {
  const response = await api.get(`/api/issues/analytics/${repoId}`)
  return response.data
}

export const getStaleIssues = async (repoId: number, stale_days = 30, page = 1, limit = 20) => {
  const response = await api.get(`/api/issues/stale/${repoId}`, { params: { stale_days, page, limit } })
  return response.data
}

// ─── Module 3: Branches ──────────────────────────────────────────────────

export const getBranches = async (repoId: number, page = 1, limit = 20, filter_type = 'all') => {
  const response = await api.get(`/api/branches/${repoId}`, { params: { page, limit, filter_type } })
  return response.data
}

export const getBranchesAnalytics = async (repoId: number) => {
  const response = await api.get(`/api/branches/analytics/${repoId}`)
  return response.data
}

// ─── Module 5: Forks ─────────────────────────────────────────────────────

export const getForks = async (repoId: number, page = 1, limit = 20, filter_type = 'all') => {
  const response = await api.get(`/api/forks/${repoId}`, { params: { page, limit, filter_type } })
  return response.data
}

export const getForksAnalytics = async (repoId: number) => {
  const response = await api.get(`/api/forks/analytics/${repoId}`)
  return response.data
}

// ─── Module 8: CI/CD ─────────────────────────────────────────────────────

export const getCICDAnalytics = async (repoId: number) => {
  const response = await api.get(`/api/cicd/analytics/${repoId}`)
  return response.data
}

export const getWorkflowRuns = async (repoId: number, page = 1, limit = 20, conclusion?: string, branch?: string) => {
  const response = await api.get(`/api/workflow-runs/${repoId}`, { params: { page, limit, conclusion, branch } })
  return response.data
}

// ─── Module 6: Discussions ────────────────────────────────────────────────

export const getDiscussions = async (repoId: number, page = 1, limit = 20) => {
  const response = await api.get(`/api/discussions/${repoId}`, { params: { page, limit } })
  return response.data
}

export const getDiscussionsAnalytics = async (repoId: number) => {
  const response = await api.get(`/api/discussions/analytics/${repoId}`)
  return response.data
}

// ─── Module 7: Projects ──────────────────────────────────────────────────

export const getProjects = async (repoId: number, page = 1, limit = 10) => {
  const response = await api.get(`/api/projects/${repoId}`, { params: { page, limit } })
  return response.data
}

export const getProjectsAnalytics = async (repoId: number) => {
  const response = await api.get(`/api/projects/analytics/${repoId}`)
  return response.data
}

// ─── Repository Health ────────────────────────────────────────────────────

export const getRepoHealth = async (repoId: number) => {
  const response = await api.get(`/api/repo-health/${repoId}`)
  return response.data
}

// ─── ML & Export ─────────────────────────────────────────────────────────

export const compareRepositories = async (urlA: string, urlB: string, githubToken?: string) => {
  const response = await api.get('/api/compare', { params: { url_a: urlA, url_b: urlB, github_token: githubToken } })
  return response.data
}

function exportQueryString(filters?: DashboardFiltersState): string {
  const params = new URLSearchParams()
  const fp = filterParams(filters)
  Object.entries(fp).forEach(([k, v]) => params.set(k, String(v)))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function getExportCsvUrl(repoId: number, filters?: DashboardFiltersState): string {
  return `${API_BASE}/api/export/${repoId}${exportQueryString(filters)}`
}

export function getExportPdfUrl(repoId: number, filters?: DashboardFiltersState): string {
  return `${API_BASE}/api/export-pdf/${repoId}${exportQueryString(filters)}`
}
