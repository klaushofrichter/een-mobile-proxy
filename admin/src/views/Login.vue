<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <h1 class="text-3xl font-bold text-gray-900">{{ appTitle }}</h1>
        <p class="mt-2 text-gray-600">Sign in to manage the OAuth proxy</p>
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

        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p class="text-sm text-yellow-700">
            Admin access is restricted to authorized users only.
            You must be listed as an admin in the proxy configuration.
          </p>
        </div>

        <button
          class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          @click="handleLogin"
        >
          Sign in with Eagle Eye Networks
        </button>
      </div>

      <p class="text-center text-xs text-gray-500">
        <a
          href="https://github.com/klaushofrichter/een-oauth-proxy/tree/develop"
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
import packageJson from '../../package.json'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const isProcessingCallback = ref(false)
const error = ref(null)

const appTitle = computed(() => packageJson.displayName || packageJson.name)
const appVersion = computed(() => packageJson.version)

function handleLogin() {
  window.location.href = getAuthUrl()
}

onMounted(async () => {
  // Set browser tab title
  document.title = appTitle.value

  // Check if this is an OAuth callback
  const code = route.query.code

  if (code) {
    isProcessingCallback.value = true
    error.value = null

    try {
      await handleAuthCallback(code)

      // Redirect to dashboard
      router.replace({ path: '/dashboard' })
    } catch (e) {
      console.error('OAuth callback error:', e)
      error.value = e.message || 'Authentication failed'
      isProcessingCallback.value = false

      // Clean up URL
      router.replace({ path: '/' })
    }
  } else if (authStore.isAuthenticated) {
    // Already authenticated, redirect to dashboard
    router.replace({ path: '/dashboard' })
  }
})
</script>
