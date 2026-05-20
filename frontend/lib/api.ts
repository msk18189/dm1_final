import axios, { isAxiosError } from 'axios'
import type { DashboardFiltersState } from '@/components/DashboardFilters'

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
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
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || d.message || String(d)).join(', ')
  }
  return err.message || 'Failed to analyze repository'
}

export const verifyRepositoryAccess = async (url: string, githubToken?: string) => {
  const response = await api.post('/api/verify-repo', {
    url,
    github_token: githubToken || null,
  })
  return response.data as {
    ok: boolean
    owner: string
    repo: string
    is_private: boolean
    url?: string
    has_token: boolean
    token_source: 'user' | 'env' | 'none'
  }
}

export const analyzeRepository = async (url: string, githubToken?: string) => {
  const response = await api.post('/api/analyze', {
    url,
    github_token: githubToken || null,
  })
  return response.data
}

export const getKPI = async (repoId: number, filters?: DashboardFiltersState) => {
  const response = await api.get(`/api/kpi/${repoId}`, { params: filterParams(filters) })
  return response.data
}

export const getOldestPRs = async (
  repoId: number,
  limit: number = 10,
  filters?: DashboardFiltersState
) => {
  const response = await api.get(`/api/oldest-prs/${repoId}`, {
    params: { limit, ...filterParams(filters) },
  })
  return response.data
}

export const getSlowestPRs = async (
  repoId: number,
  limit: number = 10,
  filters?: DashboardFiltersState
) => {
  const response = await api.get(`/api/slowest-prs/${repoId}`, {
    params: { limit, ...filterParams(filters) },
  })
  return response.data
}

export const getContributorActivity = async (
  repoId: number,
  filters?: DashboardFiltersState
) => {
  const response = await api.get(`/api/contributor-activity/${repoId}`, {
    params: filterParams(filters),
  })
  return response.data
}

export const getMonthlyFlow = async (
  repoId: number,
  months: number = 6,
  filters?: DashboardFiltersState
) => {
  const response = await api.get(`/api/monthly-flow/${repoId}`, {
    params: { months, ...filterParams(filters) },
  })
  return response.data
}

export const getThroughput = async (
  repoId: number,
  weeks: number = 8,
  filters?: DashboardFiltersState
) => {
  const response = await api.get(`/api/throughput/${repoId}`, {
    params: { weeks, ...filterParams(filters) },
  })
  return response.data
}

export const getAuthors = async (repoId: number) => {
  const response = await api.get(`/api/authors/${repoId}`)
  return response.data.authors as string[]
}

export const getPRRisk = async (repoId: number) => {
  const response = await api.get(`/api/pr-risk/${repoId}`)
  return response.data
}

export const getStaleAlerts = async (repoId: number) => {
  const response = await api.get(`/api/stale-alerts/${repoId}`)
  return response.data
}

export const compareRepositories = async (
  urlA: string,
  urlB: string,
  githubToken?: string
) => {
  const response = await api.post('/api/compare', {
    url_a: urlA,
    url_b: urlB,
    github_token: githubToken || null,
  })
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

export interface AnalyzedRepo {
  id: number
  owner: string
  name: string
  url: string
  open_prs: number
}

export async function getRepositories(): Promise<AnalyzedRepo[]> {
  const response = await api.get('/api/repositories')
  return response.data
}

