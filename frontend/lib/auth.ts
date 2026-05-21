const AUTH_USERS_KEY = 'github_pr_dashboard_users'
const AUTH_CURRENT_USER_KEY = 'github_pr_dashboard_current_user'

interface StoredUsers {
  [username: string]: string
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function loadUsers(): StoredUsers {
  if (!isBrowser()) return {}
  try {
    const raw = window.localStorage.getItem(AUTH_USERS_KEY)
    return raw ? (JSON.parse(raw) as StoredUsers) : {}
  } catch {
    return {}
  }
}

function saveUsers(users: StoredUsers): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users))
  } catch {
    // ignore storage failures
  }
}

export function getAuthUser(): string | null {
  if (!isBrowser()) return null
  try {
    return window.sessionStorage.getItem(AUTH_CURRENT_USER_KEY)
  } catch {
    return null
  }
}

export function hasStoredUsers(): boolean {
  if (!isBrowser()) return false
  const users = loadUsers()
  return Object.keys(users).length > 0
}

export function isAuthenticated(): boolean {
  return Boolean(getAuthUser())
}

export function signOut(): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.removeItem(AUTH_CURRENT_USER_KEY)
  } catch {
    // ignore
  }
}

export function signUp(username: string, password: string): { success: boolean; error?: string } {
  if (!isBrowser()) return { success: false, error: 'Client-side authentication unavailable.' }
  const normalizedUsername = username.trim()
  if (!normalizedUsername) {
    return { success: false, error: 'Enter a username.' }
  }
  if (!password) {
    return { success: false, error: 'Enter a password.' }
  }

  const users = loadUsers()
  if (users[normalizedUsername]) {
    return { success: false, error: 'Username already exists. Please sign in.' }
  }

  users[normalizedUsername] = password
  saveUsers(users)
  try {
    window.sessionStorage.setItem(AUTH_CURRENT_USER_KEY, normalizedUsername)
  } catch {
    return { success: false, error: 'Unable to complete sign up.' }
  }

  return { success: true }
}

export function signIn(username: string, password: string): { success: boolean; error?: string } {
  if (!isBrowser()) return { success: false, error: 'Client-side authentication unavailable.' }
  const normalizedUsername = username.trim()
  if (!normalizedUsername) {
    return { success: false, error: 'Enter your username.' }
  }
  if (!password) {
    return { success: false, error: 'Enter your password.' }
  }

  const users = loadUsers()
  if (!users[normalizedUsername] || users[normalizedUsername] !== password) {
    return { success: false, error: 'Invalid username or password.' }
  }

  try {
    window.sessionStorage.setItem(AUTH_CURRENT_USER_KEY, normalizedUsername)
  } catch {
    return { success: false, error: 'Unable to complete sign in.' }
  }

  return { success: true }
}
