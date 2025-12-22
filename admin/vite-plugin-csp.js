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
  return {
    name: 'csp-plugin',
    transformIndexHtml(html) {
      const proxyUrl = process.env.VITE_PROXY_URL || 'http://localhost:8787'
      
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
          const alreadyInList = connectSrcParts.some(part => {
            if (part === proxyUrl) return true
            // Check if part is a URL and matches hostname
            try {
              const partUrl = new URL(part)
              return partUrl.hostname.toLowerCase() === proxyHostname
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

