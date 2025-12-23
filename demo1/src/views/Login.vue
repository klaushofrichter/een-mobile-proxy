<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <h1 class="text-3xl font-bold text-gray-900">{{ appTitle }}</h1>
        <p class="mt-2 text-gray-600">Sign in with your Eagle Eye Networks account</p>
      </div>

      <div v-if="isProcessingCallback" class="text-center py-8">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p class="mt-4 text-gray-600">Processing authentication...</p>
      </div>

      <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-lg p-4">
        <p class="text-red-700">{{ error }}</p>
        <button
          class="mt-2 text-sm text-red-600 hover:text-red-800 underline"
          @click="error = null"
        >
          Try again
        </button>
      </div>

      <div v-else class="bg-white shadow rounded-lg p-8 space-y-6">
        <p class="text-sm text-gray-600 text-center">
          Click the button below to sign in. You will be redirected to Eagle Eye Networks
          where you can enter your email and password.
        </p>

        <div v-if="proxyOptions.length > 1">
          <label for="proxy-select" class="block text-sm font-medium text-gray-700 mb-1">
            Proxy Server
          </label>
          <select
            id="proxy-select"
            :value="selectedProxy"
            @change="handleProxyChange"
            class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          >
            <option v-for="option in proxyOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <button
          class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          @click="handleLogin"
        >
          Sign in with Eagle Eye Networks
        </button>

        <div class="relative">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-gray-300"></div>
          </div>
          <div class="relative flex justify-center text-sm">
            <span class="px-2 bg-white text-gray-500">Or</span>
          </div>
        </div>

        <button
          class="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          @click="router.push('/direct')"
        >
          Direct Access (with token)
        </button>
      </div>

      <p class="text-center text-xs text-gray-500">
        <a
          href="https://github.com/your-username/een-oauth-proxy/tree/develop"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-blue-600 hover:underline"
        >
          v{{ appVersion }}
        </a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getAuthUrl, handleAuthCallback } from '../services/auth'
import { getProxyOptions, getProxyUrl, setProxyUrl } from '../services/proxy'
import packageJson from '../../package.json'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const isProcessingCallback = ref(false)
const error = ref(null)

const proxyOptions = getProxyOptions()
const selectedProxy = ref(getProxyUrl())

const appTitle = computed(() => packageJson.displayName || packageJson.name)
const appVersion = computed(() => packageJson.version)

function handleProxyChange(event) {
  const url = event.target.value
  setProxyUrl(url)
  selectedProxy.value = url
}

function handleLogin() {
  window.location.href = getAuthUrl()
}

onMounted(async () => {
  // Set browser tab title
  document.title = appTitle.value

  // Check if this is an OAuth callback
  const code = route.query.code
  const state = route.query.state

  if (code) {
    isProcessingCallback.value = true
    error.value = null

    try {
      await handleAuthCallback(code, state)

      // Clean up URL parameters to prevent leakage
      window.history.replaceState({}, document.title, window.location.pathname)

      // Redirect to intended destination or profile
      const redirectTo = localStorage.getItem('redirectAfterLogin') || '/profile'
      localStorage.removeItem('redirectAfterLogin')

      // Clean up URL by removing code parameter
      router.replace({ path: redirectTo })
    } catch (e) {
      console.error('OAuth callback error:', e)
      error.value = e.message || 'Authentication failed'
      isProcessingCallback.value = false

      // Clean up URL
      router.replace({ path: '/' })
    }
  } else if (authStore.isAuthenticated) {
    // Already authenticated, redirect to profile
    router.replace({ path: '/profile' })
  }
})
</script>
