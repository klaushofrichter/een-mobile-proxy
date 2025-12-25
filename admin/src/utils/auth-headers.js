/**
 * Get authentication headers (Bearer token with session ID)
 * This is required for mobile/cross-site support where cookies might be blocked
 */
export async function getAuthHeaders() {
  // Dynamic import to avoid circular dependencies
  const { useAuthStore } = await import('../stores/auth')
  const authStore = useAuthStore()
  
  if (authStore.sessionId) {
    return {
      'Authorization': `Bearer ${authStore.sessionId}`
    }
  }
  return {}
}
