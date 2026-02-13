import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { revokeToken as revokeTokenService, refreshToken as refreshTokenService } from '../services/auth'

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref(null)
  const tokenExpiration = ref(null)
  const refreshTokenMarker = ref(null)
  const sessionId = ref(null) // Added for mobile/cross-site support
  const hostname = ref(null)
  const port = ref(null)
  const userProfile = ref(null)
  const refreshFailed = ref(false)
  const refreshFailedMessage = ref('')

  // Auto-refresh timer (refs for HMR safety and proper lifecycle management)
  const refreshTimerId = ref(null)
  const isRefreshing = ref(false)

  // Getters
  const isAuthenticated = computed(() => !!token.value)

  const baseUrl = computed(() => {
    if (!hostname.value) return null
    const portPart = port.value && port.value !== 443 ? `:${port.value}` : ''
    return `https://${hostname.value}${portPart}`
  })
  function safeSetItem(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (e) {
      console.warn(`[Storage] Failed to set ${key} in localStorage:`, e.message)
    }
  }

  function safeRemoveItem(key) {
    try {
      window.localStorage.removeItem(key)
    } catch (e) {
      console.warn(`[Storage] Failed to remove ${key} from localStorage:`, e.message)
    }
  }

  // Allowed EEN API domains — hostname must end with one of these
  const ALLOWED_EEN_DOMAINS = ['.eagleeyenetworks.com', '.een.cloud']

  /** Returns true if hostname is a valid EEN API domain */
  function isAllowedEenHostname(h) {
    if (!h || typeof h !== 'string') return false
    const lower = h.toLowerCase()
    // Block non-ASCII and whitespace
    if (!/^[a-z0-9.-]+$/.test(lower)) return false
    return ALLOWED_EEN_DOMAINS.some((d) => lower.endsWith(d))
  }

  // Actions
  function initialize() {
    try {
      // Restore from localStorage
      const storedToken = localStorage.getItem('auth_token')
      const storedExpiration = localStorage.getItem('token_expiration')
      const storedRefresh = localStorage.getItem('refresh_token')
      const storedSessionId = localStorage.getItem('session_id')
      const storedHostname = localStorage.getItem('hostname')
      const storedPort = localStorage.getItem('port')
      const storedProfile = localStorage.getItem('user_profile')

      if (storedToken) {
        token.value = storedToken
      }
      if (storedExpiration) {
        tokenExpiration.value = parseInt(storedExpiration, 10)
      }
      if (storedRefresh) {
        refreshTokenMarker.value = storedRefresh
      }
      if (storedSessionId) {
        sessionId.value = storedSessionId
      }
      if (storedHostname) {
        if (isAllowedEenHostname(storedHostname)) {
          hostname.value = storedHostname
        } else {
          console.warn('[Auth] Blocked invalid hostname from localStorage:', storedHostname)
          safeRemoveItem('hostname')
          safeRemoveItem('port')
        }
      }
      if (storedPort && hostname.value) {
        port.value = parseInt(storedPort, 10)
      }
      if (storedProfile) {
        try {
          userProfile.value = JSON.parse(storedProfile)
        } catch (e) {
          console.error('Failed to parse stored user profile:', e)
        }
      }

      // Set up auto-refresh if we have a refresh token
      // setupAutoRefresh() handles all edge cases including expired tokens and minimum time buffers
      if (refreshTokenMarker.value && tokenExpiration.value) {
        setupAutoRefresh()
      }
    } catch (e) {
      console.error('[Auth] Failed to initialize from localStorage:', e)
    }
  }

  function setSessionId(newId) {
    sessionId.value = newId
    if (newId) {
      // SECURITY WARNING: Storing session ID in localStorage makes it accessible to JavaScript.
      // This is necessary for mobile/cross-site support where cookies are blocked (ITP),
      // but it increases XSS risk compared to HttpOnly cookies.
      // Ensure strict CSP and other security measures are in place.
      safeSetItem('session_id', newId)
    } else {
      safeRemoveItem('session_id')
    }
  }

  function setToken(newToken, expiresIn = null) {
    token.value = newToken

    if (newToken) {
      safeSetItem('auth_token', newToken)

      if (expiresIn) {
        const expiration = Date.now() + expiresIn * 1000
        tokenExpiration.value = expiration
        safeSetItem('token_expiration', expiration.toString())
        setupAutoRefresh()
      }
    } else {
      safeRemoveItem('auth_token')
      safeRemoveItem('token_expiration')
      tokenExpiration.value = null
      clearAutoRefresh()
    }
  }

  function setRefreshToken(marker) {
    refreshTokenMarker.value = marker
    if (marker) {
      safeSetItem('refresh_token', marker)
    } else {
      safeRemoveItem('refresh_token')
    }
  }

  function setBaseUrl(data) {
    if (data) {
      const newHostname = data.hostname || data
      if (!isAllowedEenHostname(newHostname)) {
        console.warn('[Auth] Blocked invalid EEN hostname:', newHostname)
        return
      }
      hostname.value = newHostname
      port.value = data.port || 443

      safeSetItem('hostname', hostname.value)
      safeSetItem('port', port.value.toString())
    } else {
      hostname.value = null
      port.value = null
      safeRemoveItem('hostname')
      safeRemoveItem('port')
    }
  }

  function setUserProfile(profile) {
    userProfile.value = profile
    if (profile) {
      safeSetItem('user_profile', JSON.stringify(profile))
    } else {
      safeRemoveItem('user_profile')
    }
  }

  function getTokenTimeRemaining() {
    if (!tokenExpiration.value) return null
    const remaining = tokenExpiration.value - Date.now()
    return Math.max(0, remaining)
  }

  // Constants for auto-refresh timing
  const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes before expiration
  const REFRESH_THRESHOLD_RATIO = 0.5 // Or 50% of token lifetime
  const MIN_TIME_FOR_REFRESH_MS = 60 * 1000 // Don't setup refresh if less than 1 minute remaining
  const MIN_SAFE_TIMEOUT_MS = 5 * 1000 // Minimum safe timeout to avoid too-rapid firing

  function setupAutoRefresh() {
    // Guard against redundant setup calls
    if (refreshTimerId.value) {
      clearAutoRefresh()
    }

    const remaining = getTokenTimeRemaining()
    // Don't setup refresh if token is expired or has less than minimum time remaining
    if (!remaining || remaining <= MIN_TIME_FOR_REFRESH_MS) return

    // Refresh 5 minutes before expiration (or at 50% if less than 10 minutes total)
    // Ensure minimum safe timeout to avoid too-rapid firing
    const refreshTime = Math.max(
      MIN_SAFE_TIMEOUT_MS,
      Math.min(remaining - REFRESH_BUFFER_MS, remaining * REFRESH_THRESHOLD_RATIO)
    )

    if (refreshTime > 0 && refreshTime < remaining) {
      refreshTimerId.value = setTimeout(async () => {
        // Guard against concurrent refresh attempts
        if (isRefreshing.value) return
        isRefreshing.value = true

        try {
          await refreshTokenService()
        } catch (e) {
          // Log failure for monitoring/telemetry
          console.warn('[Auth] Auto-refresh failed:', {
            error: e.message,
            timestamp: new Date().toISOString()
          })
          // Set refresh failed state - UI will show dialog and handle redirect
          refreshFailed.value = true
          refreshFailedMessage.value = e.message || 'Session expired. Please log in again.'
        } finally {
          isRefreshing.value = false
        }
      }, refreshTime)
    }
  }

  function clearAutoRefresh() {
    if (refreshTimerId.value) {
      clearTimeout(refreshTimerId.value)
      refreshTimerId.value = null
    }
    isRefreshing.value = false
  }

  function clearState() {
    // Clear all state without revoking tokens
    token.value = null
    tokenExpiration.value = null
    refreshTokenMarker.value = null
    sessionId.value = null
    hostname.value = null
    port.value = null
    userProfile.value = null
    refreshFailed.value = false
    refreshFailedMessage.value = ''

    // Clear localStorage
    safeRemoveItem('auth_token')
    safeRemoveItem('token_expiration')
    safeRemoveItem('refresh_token')
    safeRemoveItem('session_id')
    safeRemoveItem('hostname')
    safeRemoveItem('port')
    safeRemoveItem('user_profile')
    safeRemoveItem('redirectAfterLogin')

    clearAutoRefresh()
  }

  function acknowledgeRefreshFailure() {
    // Called when user acknowledges the refresh failure dialog
    // Clear state and allow redirect to login
    clearState()
  }

  async function logout() {
    // Revoke token at proxy
    if (refreshTokenMarker.value) {
      try {
        await revokeTokenService()
      } catch (e) {
        console.error('Failed to revoke token:', e)
      }
    }
    clearState()
  }

  return {
    // State
    token,
    tokenExpiration,
    refreshTokenMarker,
    sessionId,
    hostname,
    port,
    userProfile,
    refreshFailed,
    refreshFailedMessage,
    // Getters
    isAuthenticated,
    baseUrl,
    // Actions
    initialize,
    setToken,
    setRefreshToken,
    setSessionId,
    setBaseUrl,
    setUserProfile,
    getTokenTimeRemaining,
    clearState,
    acknowledgeRefreshFailure,
    logout
  }
})
