/**
 * Vite plugin to inject CSP meta tag
 *
 * Since the admin SPA is served from the same origin as the proxy
 * (via Cloudflare Workers Static Assets), all proxy calls are covered by 'self'.
 * We only need external domains for the EEN OAuth flow and direct API calls.
 */
export function cspPlugin() {
  return {
    name: 'csp-plugin',
    transformIndexHtml(html) {
      const connectSrc = [
        "'self'",
        'https://auth.eagleeyenetworks.com',
        'https://*.eagleeyenetworks.com'
      ].join(' ')

      // Replace the connect-src part of the CSP
      const cspRegex = /(connect-src\s+)[^;]+(?=;|")/i
      if (cspRegex.test(html)) {
        return html.replace(cspRegex, `$1${connectSrc}`)
      } else {
        console.warn('CSP connect-src directive not found in expected format, skipping injection')
        return html
      }
    }
  }
}
