/**
 * Proxy service for URL management
 */

const STORAGE_KEY = 'een_proxy_url'
const ENV_PROXY_URL = import.meta.env.VITE_PROXY_URL
const CLOUDFLARE_PROXY_URL = 'https://een-oauth-proxy.klaushofrichter.workers.dev'
const LOCAL_PROXY_URL = 'http://localhost:8787'
const DEFAULT_PROXY_URL = ENV_PROXY_URL || LOCAL_PROXY_URL

/**
 * Check if running in production (GitHub Pages)
 */
function isProduction() {
  return window.location.hostname.includes('github.io')
}

/**
 * Get available proxy options based on environment
 * - In production: only Cloudflare (and custom env if different)
 * - In development: both local and Cloudflare options
 */
export function getProxyOptions() {
  const options = []

  // In production, only show Cloudflare; in dev, show both
  if (isProduction()) {
    options.push({ label: 'Cloudflare (Workers)', value: CLOUDFLARE_PROXY_URL })
  } else {
    options.push({ label: 'Local (localhost:8787)', value: LOCAL_PROXY_URL })
    options.push({ label: 'Cloudflare (Workers)', value: CLOUDFLARE_PROXY_URL })
  }

  // Add env variable URL if it's different from predefined options
  if (ENV_PROXY_URL && !options.some((opt) => opt.value === ENV_PROXY_URL)) {
    options.unshift({ label: `Env (${ENV_PROXY_URL})`, value: ENV_PROXY_URL })
  }

  return options
}

/**
 * Get the configured proxy URL (from localStorage or default)
 * In production, defaults to Cloudflare and ignores localhost if stored
 */
export function getProxyUrl() {
  const stored = localStorage.getItem(STORAGE_KEY)

  if (isProduction()) {
    // In production, don't use localhost even if stored
    if (!stored || stored === LOCAL_PROXY_URL) {
      return CLOUDFLARE_PROXY_URL
    }
    return stored
  }

  return stored || DEFAULT_PROXY_URL
}

/**
 * Set the proxy URL (stores in localStorage)
 */
export function setProxyUrl(url) {
  localStorage.setItem(STORAGE_KEY, url)
}
