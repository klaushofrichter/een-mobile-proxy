import { loadEnv } from 'vite'

/**
 * Vite plugin to inject proxy URL into CSP meta tag from VITE_PROXY_URL
 * Dynamically builds the connect-src directive based on environment
 * 
 * Note: Since users can select a proxy at runtime from a dropdown, we need to
 * include all possible proxy URLs in the CSP. The dropdown only shows:
 * - localhost (for dev)
 * - VITE_PROXY_URL (configured proxy)
 * 
 * We always include localhost for dev compatibility, and add VITE_PROXY_URL
 * if it's different from localhost.
 */
export function cspPlugin() {
  let proxyUrl = 'http://localhost:8787'
  let configInitialized = false
  
  return {
    name: 'csp-plugin',
    configResolved(config) {
      // Defensive validation for config.mode - must be a string
      let mode = 'development'
      if (config?.mode && typeof config.mode === 'string') {
        mode = config.mode
      } else if (config?.mode) {
        console.warn(`CSP plugin: config.mode is not a string (${typeof config.mode}), using default 'development'`)
      }
      try {
        // Load environment variables based on Vite's mode
        const env = loadEnv(mode, process.cwd(), 'VITE_')
        proxyUrl = env.VITE_PROXY_URL || 'http://localhost:8787'
        configInitialized = true
      } catch (error) {
        console.warn(`CSP plugin: Failed to load environment variables for mode "${mode}":`, error.message)
        // Keep default proxyUrl
        configInitialized = true
      }
    },
    transformIndexHtml(html) {
      // Lifecycle check: warn if configResolved wasn't called
      if (!configInitialized) {
        console.warn('CSP plugin: transformIndexHtml called before configResolved, using default proxy URL')
      }
      
      // Build connect-src directive - always include localhost for dev compatibility
      // Users can select between localhost and VITE_PROXY_URL at runtime,
      // so we need both in the CSP
      const connectSrcParts = [
        "'self'",
        'http://localhost:8787',
        'http://127.0.0.1:8787',
        'https://auth.eagleeyenetworks.com',
        'https://*.eagleeyenetworks.com'
      ]
      
      // Add the proxy URL if it's not already in the list (and not localhost)
      // Use URL parsing for precise hostname matching to avoid false positives
      let shouldAddProxyUrl = false
      if (proxyUrl) {
        try {
          const proxyUrlObj = new URL(proxyUrl)
          const proxyHostname = proxyUrlObj.hostname.toLowerCase()
          
          // Check if it's already in the list
          // Compare full URLs (including protocol) to allow different protocols for same hostname
          const alreadyInList = connectSrcParts.some(part => {
            if (part === proxyUrl) return true
            // For exact matches, return true
            // For hostname-only matches, we allow different protocols (http vs https)
            try {
              const partUrl = new URL(part)
              // Only consider it a duplicate if both protocol and hostname match
              return partUrl.protocol === proxyUrlObj.protocol && 
                     partUrl.hostname.toLowerCase() === proxyHostname
            } catch {
              return false
            }
          })
          
          // Only add if not already in list and not a localhost variant
          // Use hostname comparison instead of string includes to avoid false positives
          const isLocalhost = proxyHostname === 'localhost' || 
                             proxyHostname === '127.0.0.1' || 
                             proxyHostname === '[::1]' ||
                             proxyHostname.startsWith('127.') ||
                             proxyHostname.endsWith('.localhost')
          
          shouldAddProxyUrl = !alreadyInList && !isLocalhost
        } catch (error) {
          // If URL parsing fails, fall back to simple string check
          console.warn(`Invalid proxy URL format: ${proxyUrl}, skipping CSP injection`)
          shouldAddProxyUrl = false
        }
      }
      
      if (shouldAddProxyUrl) {
        connectSrcParts.push(proxyUrl)
      }
      
      const connectSrc = connectSrcParts.join(' ')
      
      // Validate that final CSP doesn't contain unexpected wildcard origins
      // Only allow the specific wildcard pattern for EEN domains
      // Split by spaces and check each origin individually
      const origins = connectSrc.split(/\s+/)
      const allowedWildcard = 'https://*.eagleeyenetworks.com'
      const wildcardOrigins = origins.filter(origin => origin.includes('*'))
      const allowedWildcardCount = wildcardOrigins.filter(origin => origin === allowedWildcard).length
      const unexpectedWildcards = wildcardOrigins.filter(origin => origin !== allowedWildcard)
      
      // Warn if allowed wildcard appears multiple times (shouldn't happen, but not critical)
      if (allowedWildcardCount > 1) {
        console.warn(`⚠️ Warning: Allowed wildcard '${allowedWildcard}' appears ${allowedWildcardCount} times in CSP`)
      }
      
      if (unexpectedWildcards.length > 0) {
        console.error(`❌ Security: CSP contains unexpected wildcard origins: ${unexpectedWildcards.join(', ')}`)
        console.error('Only https://*.eagleeyenetworks.com is allowed as a wildcard origin')
        throw new Error(`CSP validation failed: unexpected wildcard origins detected`)
      }
      
      // Replace the connect-src part of the CSP with more robust regex
      // Match connect-src followed by whitespace and everything up to semicolon (or end if last directive)
      // The regex handles both cases: with semicolon after, or as last directive before closing quote
      const cspRegex = /(connect-src\s+)[^;]+(?=;|")/i
      if (cspRegex.test(html)) {
        return html.replace(cspRegex, `$1${connectSrc}`)
      } else {
        // Fallback: if regex doesn't match, log warning but don't fail build
        console.warn('CSP connect-src directive not found in expected format, skipping injection')
        return html
      }
    }
  }
}

