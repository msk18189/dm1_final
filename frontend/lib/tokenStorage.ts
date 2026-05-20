const STORAGE_KEY = 'github_pr_dashboard_token'

export function loadGithubToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveGithubToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = token.trim()
    if (trimmed) {
      sessionStorage.setItem(STORAGE_KEY, trimmed)
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // sessionStorage unavailable
  }
}
