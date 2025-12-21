<template>
  <!-- Admin Dashboard with resizable panels, dark mode, and responsive layout -->
  <div :class="['min-h-screen py-4 px-4 transition-colors duration-200', isDarkMode ? 'bg-gray-900' : 'bg-gray-50']">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-4">
        <div>
          <h1 :class="['text-xl font-bold', isDarkMode ? 'text-white' : 'text-gray-900']">{{ appTitle }}</h1>
          <p :class="['text-xs', isDarkMode ? 'text-gray-400' : 'text-gray-500']">{{ authStore.userProfile?.email || 'Unknown' }}</p>
        </div>
        <div class="flex items-center space-x-3">
          <!-- Dark Mode Toggle -->
          <button
            @click="toggleDarkMode"
            :class="['p-1.5 rounded transition-colors', isDarkMode ? 'text-yellow-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-200']"
            :title="isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <svg v-if="isDarkMode" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd" />
            </svg>
            <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          </button>
          <a
            href="https://github.com/klaushofrichter/een-oauth-proxy/tree/develop"
            target="_blank"
            rel="noopener noreferrer"
            :class="['text-xs hover:text-blue-600 hover:underline', isDarkMode ? 'text-gray-500' : 'text-gray-400']"
          >v{{ appVersion }}</a>
          <button
            :disabled="isLoggingOut"
            :class="['px-3 py-1.5 text-white text-xs rounded disabled:opacity-50', isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-600 hover:bg-gray-700']"
            @click="handleLogout"
          >
            {{ isLoggingOut ? 'Logging out...' : 'Logout' }}
          </button>
        </div>
      </div>

      <!-- Main Resizable Layout -->
      <div class="resizable-container flex flex-col gap-4 mb-4" ref="containerRef" :style="{ '--left-width': `${leftWidth}%`, '--right-width': `${100 - leftWidth}%` }">
        <!-- Left Column: Health & Stats -->
        <div class="left-panel space-y-4 overflow-hidden">
          <!-- Proxy Health -->
          <div :class="['shadow rounded-lg p-4', isDarkMode ? 'bg-gray-800' : 'bg-white']">
            <div class="flex justify-between items-center mb-3">
              <div class="flex items-center space-x-2">
                <span
                  class="inline-block w-2.5 h-2.5 rounded-full"
                  :class="healthStatus === 'ok' ? 'bg-green-500' : 'bg-red-500'"
                ></span>
                <span :class="['text-sm font-medium', isDarkMode ? 'text-white' : 'text-gray-900']">Proxy Health</span>
                <span :class="['text-xs font-mono', isDarkMode ? 'text-gray-500' : 'text-gray-400']">{{ proxyUrl }}</span>
              </div>
              <div class="flex items-center space-x-2">
                <button
                  :disabled="loadingHealth || refreshDisabledAfterRemove"
                  class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                  @click="manualUpdate"
                >
                  {{ loadingHealth ? '...' : 'Update now' }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div :class="['rounded p-2', isDarkMode ? 'bg-gray-700' : 'bg-gray-50']">
                <p :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">Status</p>
                <p class="font-medium" :class="healthStatus === 'ok' ? 'text-green-500' : 'text-red-500'">
                  {{ healthStatus === 'ok' ? 'Healthy' : (healthStatus || 'Unknown') }}
                </p>
              </div>
              <div :class="['rounded p-2', isDarkMode ? 'bg-gray-700' : 'bg-gray-50']">
                <p :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">Checked</p>
                <p :class="isDarkMode ? 'text-white' : 'text-gray-900'">
                  {{ lastHealthCheckText }}
                  <span v-if="healthAutoRefresh" :class="['text-xs', isDarkMode ? 'text-gray-500' : 'text-gray-400']">
                    (again in {{ refreshCountdown }}s)
                  </span>
                </p>
              </div>
            </div>
            <div v-if="healthError" :class="['mt-2 p-2 rounded text-xs', isDarkMode ? 'bg-red-900/50 border border-red-700 text-red-400' : 'bg-red-50 border border-red-200 text-red-700']">
              {{ healthError }}
            </div>
          </div>

          <!-- Stats Row -->
          <div class="grid grid-cols-2 gap-4">
            <div :class="['shadow rounded-lg p-4', isDarkMode ? 'bg-gray-800' : 'bg-white']">
              <div class="flex justify-between items-center">
                <span :class="['text-xs', isDarkMode ? 'text-gray-400' : 'text-gray-500']">Active Sessions</span>
              </div>
              <p :class="['text-2xl font-bold mt-1', isDarkMode ? 'text-white' : 'text-gray-900']">{{ sessionCount ?? 0 }}</p>
            </div>
            <div :class="['shadow rounded-lg p-4', isDarkMode ? 'bg-gray-800' : 'bg-white']">
              <span :class="['text-xs', isDarkMode ? 'text-gray-400' : 'text-gray-500']">Versions</span>
              <div class="mt-1 text-xs space-y-1">
                <div class="flex justify-between">
                  <span :class="isDarkMode ? 'text-gray-400' : 'text-gray-600'">Admin:</span>
                  <span class="font-mono" :class="isDarkMode ? 'text-white' : ''">v{{ appVersion }}</span>
                </div>
                <div class="flex justify-between">
                  <span :class="isDarkMode ? 'text-gray-400' : 'text-gray-600'">Proxy:</span>
                  <span class="font-mono truncate ml-2" :class="isDarkMode ? 'text-white' : ''" :title="proxyVersion">v{{ proxyVersion?.split(' - ')[1] || 'Unknown' }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div :class="['shadow rounded-lg p-4 space-y-3', isDarkMode ? 'bg-gray-800' : 'bg-white']">
            <div :class="['flex items-center justify-between p-3 rounded border', isDarkMode ? 'bg-amber-900/30 border-amber-600' : 'bg-amber-50 border-amber-300']">
              <div>
                <p :class="['text-sm font-medium', isDarkMode ? 'text-amber-400' : 'text-amber-800']">Remove Other Sessions</p>
                <p :class="['text-xs', isDarkMode ? 'text-amber-500' : 'text-amber-600']">Log out other users</p>
              </div>
              <button
                :disabled="isRemovingSessions"
                class="px-3 py-1.5 bg-amber-500 text-white text-xs rounded hover:bg-amber-600 disabled:opacity-50"
                @click="handleRemoveSessions"
              >
                {{ isRemovingSessions ? '...' : 'Remove' }}
              </button>
            </div>
            <div :class="['flex items-center justify-between p-3 rounded border', isDarkMode ? 'bg-red-900/30 border-red-700' : 'bg-red-50 border-red-200']">
              <div>
                <p :class="['text-sm font-medium', isDarkMode ? 'text-red-400' : 'text-red-900']">Revoke All Tokens</p>
                <p :class="['text-xs', isDarkMode ? 'text-red-500' : 'text-red-700']">Emergency: logs out everyone including you</p>
              </div>
              <button
                :disabled="isRevokingAll"
                class="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                @click="confirmRevokeAll"
              >
                {{ isRevokingAll ? '...' : 'Revoke All' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Resize Handle (hidden on small screens via CSS) -->
        <div
          class="hidden lg:flex w-2 cursor-col-resize items-center justify-center group"
          @mousedown="startResize"
          @touchstart="startResize"
        >
          <div :class="['w-1 h-16 rounded transition-colors', isDarkMode ? 'bg-gray-700 group-hover:bg-gray-600' : 'bg-gray-300 group-hover:bg-gray-400']"></div>
        </div>

        <!-- Right Column: Activity Log -->
        <div :class="['right-panel shadow rounded-lg p-4 flex flex-col', isDarkMode ? 'bg-gray-800' : 'bg-white']" style="max-height: 500px">
          <div class="flex justify-between items-center mb-2">
            <span :class="['text-sm font-medium', isDarkMode ? 'text-white' : 'text-gray-900']">Activity Log</span>
            <button
              :class="['px-2 py-1 text-xs rounded', isDarkMode ? 'text-gray-300 bg-gray-700 border border-gray-600 hover:bg-gray-600' : 'text-gray-600 bg-gray-100 border border-gray-300 hover:bg-gray-200 hover:text-gray-800']"
              @click="clearLog"
            >
              Clear
            </button>
          </div>
          <div class="flex-1 overflow-y-auto text-xs space-y-1 font-mono" ref="logContainer">
            <div
              v-for="(entry, index) in activityLog"
              :key="index"
              :class="['py-1 border-b last:border-0', isDarkMode ? 'border-gray-700' : 'border-gray-100']"
            >
              <span :class="isDarkMode ? 'text-gray-500' : 'text-gray-400'">{{ entry.time }}</span>
              <span :class="['ml-2', entry.type === 'error' ? 'text-red-500' : entry.type === 'success' ? 'text-green-500' : isDarkMode ? 'text-gray-300' : 'text-gray-600']">{{ entry.message }}</span>
            </div>
            <div v-if="activityLog.length === 0" :class="['text-center py-4', isDarkMode ? 'text-gray-500' : 'text-gray-400']">
              No activity yet
            </div>
          </div>
        </div>
      </div>

      <!-- Confirmation Modal -->
      <div
        v-if="showConfirmModal"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      >
        <div :class="['rounded-lg p-5 max-w-sm mx-4', isDarkMode ? 'bg-gray-800' : 'bg-white']">
          <h3 class="text-base font-bold text-red-500 mb-3">Confirm Revoke All</h3>
          <p :class="['text-sm mb-4', isDarkMode ? 'text-gray-300' : 'text-gray-700']">
            This will revoke all tokens and log out all users including yourself.
          </p>
          <div class="flex space-x-3">
            <button
              :class="['flex-1 px-3 py-2 text-sm rounded', isDarkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300']"
              @click="showConfirmModal = false"
            >
              Cancel
            </button>
            <button
              class="flex-1 px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700"
              @click="handleRevokeAll"
            >
              Revoke All
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getHealth, getProxyUrl, getSessionsCount, removeSessions, revokeAll } from '../services/admin'
import packageJson from '../../package.json'

const router = useRouter()
const authStore = useAuthStore()

// Dark mode state
const isDarkMode = ref(localStorage.getItem('darkMode') === 'true')

function toggleDarkMode() {
  isDarkMode.value = !isDarkMode.value
  localStorage.setItem('darkMode', isDarkMode.value)
  addLogEntry(`Theme: ${isDarkMode.value ? 'dark' : 'light'} mode`, 'info')
}

// Resizable panel state
const leftWidth = ref(parseFloat(localStorage.getItem('panelWidth')) || 66)
const containerRef = ref(null)
let isResizing = false

function startResize(e) {
  isResizing = true
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
  document.addEventListener('touchmove', onResize)
  document.addEventListener('touchend', stopResize)
  e.preventDefault()
}

function onResize(e) {
  if (!isResizing || !containerRef.value) return

  const container = containerRef.value
  const rect = container.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const newWidth = ((clientX - rect.left) / rect.width) * 100

  // Clamp between 30% and 80%
  leftWidth.value = Math.min(80, Math.max(30, newWidth))
}

function stopResize() {
  isResizing = false
  localStorage.setItem('panelWidth', leftWidth.value)
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  document.removeEventListener('touchmove', onResize)
  document.removeEventListener('touchend', stopResize)
}

// State
const sessionCount = ref(null)
const loadingSessions = ref(false)
const isRemovingSessions = ref(false)
const refreshDisabledAfterRemove = ref(false)
const isPollingKv = ref(false) // Guard against concurrent KV polling
const isRevokingAll = ref(false)
const isLoggingOut = ref(false)
const showConfirmModal = ref(false)

// Health check state
const healthStatus = ref(null)
const proxyVersion = ref(null)
const lastHealthCheck = ref(null)
const loadingHealth = ref(false)
const healthError = ref(null)
const healthAutoRefresh = ref(true)

// Auto-refresh interval
let healthInterval = null
let countdownInterval = null
const HEALTH_CHECK_INTERVAL = 60000 // 1 minute
const refreshCountdown = ref(60)

// Activity log
const MAX_LOG_ENTRIES = 250
const activityLog = ref([])
const logContainer = ref(null)

const appTitle = computed(() => packageJson.displayName || packageJson.name)
const appVersion = computed(() => packageJson.version)
const proxyUrl = computed(() => getProxyUrl())

const lastHealthCheckText = computed(() => {
  if (!lastHealthCheck.value) return 'Never'
  const date = new Date(lastHealthCheck.value)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
})

// Add entry to activity log
function addLogEntry(message, type = 'info') {
  const now = new Date()
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`

  activityLog.value.unshift({ time, message, type })

  // Limit entries
  if (activityLog.value.length > MAX_LOG_ENTRIES) {
    activityLog.value = activityLog.value.slice(0, MAX_LOG_ENTRIES)
  }
}

function clearLog() {
  activityLog.value = []
  addLogEntry('Log cleared', 'info')
}

// Check proxy health
async function checkHealth(isManual = false) {
  loadingHealth.value = true
  healthError.value = null

  try {
    const data = await getHealth()
    healthStatus.value = data.status
    proxyVersion.value = data.version
    lastHealthCheck.value = Date.now()
    if (isManual) {
      addLogEntry(`Health check: ${data.status}`, data.status === 'ok' ? 'success' : 'error')
    }
  } catch (e) {
    healthStatus.value = 'error'
    healthError.value = e.message || 'Health check failed'
    lastHealthCheck.value = Date.now()
    addLogEntry(`Health check failed: ${e.message}`, 'error')
  } finally {
    loadingHealth.value = false
  }
}

async function manualUpdate() {
  refreshCountdown.value = HEALTH_CHECK_INTERVAL / 1000
  // Fetch both without individual logging, then log combined result
  await Promise.all([checkHealth(false), fetchSessionCount(false)])
  addLogEntry(`Health: ${healthStatus.value}, Sessions: ${sessionCount.value ?? 0}`, healthStatus.value === 'ok' ? 'success' : 'error')
}

// Start auto-refresh with countdown
function startHealthAutoRefresh() {
  if (healthInterval) return

  refreshCountdown.value = HEALTH_CHECK_INTERVAL / 1000

  healthInterval = setInterval(() => {
    checkHealth(false)
    refreshCountdown.value = HEALTH_CHECK_INTERVAL / 1000
  }, HEALTH_CHECK_INTERVAL)

  countdownInterval = setInterval(() => {
    if (refreshCountdown.value > 0) {
      refreshCountdown.value--
    }
  }, 1000)

  healthAutoRefresh.value = true
}

function stopHealthAutoRefresh() {
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
  healthAutoRefresh.value = false
}

// Fetch session count
async function fetchSessionCount(isManual = false) {
  loadingSessions.value = true

  try {
    const data = await getSessionsCount()
    sessionCount.value = data.sessionCount
    if (isManual) {
      addLogEntry(`Session count: ${data.sessionCount}`, 'success')
    }
  } catch (e) {
    addLogEntry(`Failed to fetch sessions: ${e.message}`, 'error')
  } finally {
    loadingSessions.value = false
  }
}

// Check if error is an authentication/authorization error
function isAuthError(error) {
  if (!error) return false
  // Check error message for status codes
  const message = error.message || ''
  if (message.includes('401') || message.includes('403')) return true
  // Check for common auth error text
  if (message.toLowerCase().includes('unauthorized')) return true
  if (message.toLowerCase().includes('forbidden')) return true
  // Check error status property if available
  if (error.status === 401 || error.status === 403) return true
  return false
}

// Wait for KV consistency using exponential backoff polling
async function waitForKvConsistency(expectedCount) {
  // Guard against concurrent polling operations
  if (isPollingKv.value) {
    return false
  }
  isPollingKv.value = true

  const maxAttempts = 5
  try {
    for (let i = 0; i < maxAttempts; i++) {
      const delay = 500 * Math.pow(2, i) // 500ms, 1s, 2s, 4s, 8s
      await new Promise(resolve => setTimeout(resolve, delay))
      try {
        const fresh = await getSessionsCount()
        if (fresh.sessionCount === expectedCount) {
          return true // KV is consistent
        }
      } catch (error) {
        // Stop polling on auth errors - session may have expired
        if (isAuthError(error)) {
          addLogEntry('Auth error during KV sync', 'error')
          return false
        }
        // For network errors, continue polling - they may be transient
      }
    }
    return false // Gave up waiting
  } finally {
    isPollingKv.value = false
  }
}

// Remove other sessions
async function handleRemoveSessions() {
  isRemovingSessions.value = true
  addLogEntry('Removing other sessions...', 'info')

  try {
    const result = await removeSessions()
    addLogEntry(`Removed ${result.deletedSessions} session(s)`, 'success')
    // Use the returned count directly to avoid KV eventual consistency issues.
    // The API returns the accurate count after the operation completes.
    if (result.remainingSessions !== undefined) {
      sessionCount.value = result.remainingSessions
      // Disable refresh and poll for KV consistency using exponential backoff
      refreshDisabledAfterRemove.value = true
      waitForKvConsistency(result.remainingSessions).then((consistent) => {
        if (consistent) {
          addLogEntry('KV storage synchronized', 'success')
        } else {
          addLogEntry('KV sync timeout - display may be stale', 'info')
        }
      }).catch((error) => {
        if (isAuthError(error)) {
          addLogEntry('Session expired during KV sync', 'error')
        } else {
          addLogEntry(`KV sync error: ${error.message}`, 'error')
        }
      }).finally(() => {
        refreshDisabledAfterRemove.value = false
      })
    } else {
      await fetchSessionCount(false)
    }
  } catch (e) {
    addLogEntry(`Failed to remove sessions: ${e.message}`, 'error')
  } finally {
    isRemovingSessions.value = false
  }
}

function confirmRevokeAll() {
  showConfirmModal.value = true
}

async function handleRevokeAll() {
  showConfirmModal.value = false
  isRevokingAll.value = true
  addLogEntry('Revoking all tokens...', 'info')

  try {
    await revokeAll()
    addLogEntry('All tokens revoked', 'success')
    await authStore.logout()
    router.push('/')
  } catch (e) {
    addLogEntry(`Failed to revoke tokens: ${e.message}`, 'error')
    isRevokingAll.value = false
  }
}

async function handleLogout() {
  isLoggingOut.value = true
  addLogEntry('Logging out...', 'info')

  try {
    await authStore.logout()
    router.push('/')
  } catch (e) {
    console.error('Logout error:', e)
    router.push('/')
  }
}

async function fetchUserProfile() {
  if (authStore.userProfile) return

  try {
    const response = await fetch(`${authStore.baseUrl}/api/v3.0/users/self`, {
      headers: {
        Authorization: `Bearer ${authStore.token}`,
        Accept: 'application/json'
      }
    })

    if (response.ok) {
      const data = await response.json()
      authStore.setUserProfile({
        id: data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email
      })
    }
  } catch (e) {
    console.error('Failed to fetch user profile:', e)
  }
}

onMounted(async () => {
  document.title = `${appTitle.value} - Dashboard`

  addLogEntry('Dashboard loaded', 'info')

  await Promise.all([
    checkHealth(false),
    fetchSessionCount(false),
    fetchUserProfile()
  ])

  addLogEntry(`Health: ${healthStatus.value}, Sessions: ${sessionCount.value ?? 0}`, 'success')
  startHealthAutoRefresh()
})

onUnmounted(() => {
  stopHealthAutoRefresh()
})
</script>

<style scoped>
/* Mobile first: stacked layout, full width */
.resizable-container {
  flex-direction: column;
  gap: 1rem;
  overflow: hidden;
}

.left-panel,
.right-panel {
  width: 100% !important;
  flex-shrink: 1;
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
}

/* Desktop (>=1024px): side-by-side layout with resizable widths */
@media (min-width: 1024px) {
  .resizable-container {
    flex-direction: row;
    gap: 0.25rem;
  }

  .left-panel {
    width: var(--left-width, 66%) !important;
    flex-shrink: 0;
    flex-grow: 0;
  }

  .right-panel {
    width: auto !important;
    flex-shrink: 1;
    flex-grow: 1;
  }
}
</style>
