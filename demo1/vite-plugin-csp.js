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
      if (proxyUrl && 
          !connectSrcParts.includes(proxyUrl) && 
          !proxyUrl.includes('localhost') && 
          !proxyUrl.includes('127.0.0.1')) {
        connectSrcParts.push(proxyUrl)
      }
      
      const connectSrc = connectSrcParts.join(' ')
      
      // Replace the connect-src part of the CSP
      return html.replace(
        /(connect-src\s+)[^;]+/,
        `$1${connectSrc}`
      )
    }
  }
}

