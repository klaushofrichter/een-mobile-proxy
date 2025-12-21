/**
 * Proxy service for URL management
 */

const STORAGE_KEY = 'een_proxy_url'
const ENV_PROXY_URL = import.meta.env.VITE_PROXY_URL
const CLOUDFLARE_PROXY_URL = 'https://een-oauth-proxy.klaushofrichter.workers.dev'
const LOCAL_PROXY_URL = 'http://localhost:8787'
const DEFAULT_PROXY_URL = ENV_PROXY_URL || LOCAL_PROXY_URL

// Allowed proxy hosts for security validation
const ALLOWED_PROXY_HOSTS = [
  'localhost',
  '127.0.0.1',
  'een-oauth-proxy.klaushofrichter.workers.dev'
]

// Validate and extract ENV_PROXY_URL hostname at module initialization
let ENV_PROXY_HOSTNAME = null
if (ENV_PROXY_URL) {
  try {
    const parsed = new URL(ENV_PROXY_URL)
    // Only trust ENV_PROXY_URL if it's HTTPS (or localhost for dev)
    if (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      ENV_PROXY_HOSTNAME = parsed.hostname
    } else {
      console.warn('ENV_PROXY_URL must use HTTPS in production, ignoring:', ENV_PROXY_URL)
    }
  } catch {
    console.warn('Invalid ENV_PROXY_URL format, ignoring:', ENV_PROXY_URL)
  }
}

/**
 * Check if running in production (GitHub Pages)
 * Uses both Vite's build mode and strict hostname check
 */
function isProduction() {
  // Check Vite's production mode first
  if (import.meta.env.PROD) return true
  // Fallback to strict hostname check for GitHub Pages
  return window.location.hostname === 'klaushofrichter.github.io'
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
 * Validate if a URL is an allowed proxy URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if URL is valid and allowed
 */
function isValidProxyUrl(url) {
  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname

    // Check if hostname is in allowed list
    if (ALLOWED_PROXY_HOSTS.includes(hostname)) {
      return true
    }

    // Also allow validated ENV_PROXY_URL hostname if configured
    if (ENV_PROXY_HOSTNAME && hostname === ENV_PROXY_HOSTNAME) {
      return true
    }

    return false
  } catch {
    // Invalid URL format
    return false
  }
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
    // Enforce HTTPS in production
    if (!stored.startsWith('https://')) {
      console.warn('HTTP proxy not allowed in production, using default')
      return CLOUDFLARE_PROXY_URL
    }
    // Validate the stored URL
    if (!isValidProxyUrl(stored)) {
      console.warn('Invalid proxy URL in storage, using default')
      return CLOUDFLARE_PROXY_URL
    }
    return stored
  }

  return stored || DEFAULT_PROXY_URL
}

/**
 * Set the proxy URL (stores in localStorage)
 * Validates URL before storing to prevent malicious redirects
 * @param {string} url - Proxy URL to store
 * @returns {boolean} - True if URL was stored, false if rejected
 */
export function setProxyUrl(url) {
  // Validate URL format and allowed hosts
  if (!isValidProxyUrl(url)) {
    console.warn('Rejected invalid proxy URL:', url)
    return false
  }

  // In production, enforce HTTPS (except localhost for testing)
  if (isProduction() && !url.startsWith('https://')) {
    console.warn('HTTP proxy not allowed in production')
    return false
  }

  localStorage.setItem(STORAGE_KEY, url)
  return true
}
