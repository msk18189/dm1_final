const AUTH_TOKEN_KEY = 'prism_auth_token'

function decodeJwt(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    return JSON.parse(jsonPayload)
  } catch (e) {
    return null
  }
}

export function saveAuthToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
  } catch (err) {
    console.error('Failed to save auth token', err)
  }
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function getAuthUser(): Promise<{ username: string; email?: string } | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (!token) return Promise.resolve(null)
    
    const payload = decodeJwt(token)
    if (!payload) return Promise.resolve(null)
    
    // Auto logout if expired
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      signOut()
      return Promise.resolve(null)
    }
    
    return Promise.resolve({
      username: payload.sub || '',
      email: payload.email || '',
    })
  } catch (err) {
    console.error('Failed to get auth user', err)
    return Promise.resolve(null)
  }
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (!token) return false
    
    const payload = decodeJwt(token)
    if (!payload) return false
    
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      signOut()
      return false
    }
    
    return true
  } catch {
    return false
  }
}

export function signOut(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch (err) {
    console.error('Failed to clear token', err)
  }
}
