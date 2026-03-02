# EEN Mobile Proxy

A Cloudflare Worker OAuth proxy designed for native iOS and Android apps integrating with Eagle Eye Networks (EEN). Forked from [een-oauth-proxy](https://github.com/klaushofrichter/een-oauth-proxy), this variant removes browser-specific features (CORS, cookies, CSP headers) and adds mobile-native support (custom URL schemes, Bearer-only auth).

Users need a CLIENT_ID and CLIENT_SECRET for OAuth with [Eagle Eye Networks](https://www.een.com/), and at least one user account. See the [Eagle Eye Networks Developer Portal](https://developer.eagleeyenetworks.com/) for details.

This repository is provided as-is without warranty. It uses EEN services but is not affiliated with EEN.

## Architecture

```
iOS / Android App
        │ HTTPS + Bearer Token
        ▼
Cloudflare Worker (proxy/src/index.js)
   ├── Cloudflare KV (session/token storage)
   ├── Static Assets (admin SPA)
   └── EEN OAuth API (eagleeyenetworks.com)
```

- **proxy/** — Single-file Cloudflare Worker handling OAuth token exchange, session management, admin endpoints, rate limiting, and SSRF protection
- **admin/** — Vue 3 + Pinia + TailwindCSS 4 admin dashboard for session management, served as static assets by the Worker
- **scripts/** — Build, deploy, and test automation

## Key Differences from een-oauth-proxy

| Feature | een-oauth-proxy (Web) | een-mobile-proxy (Mobile) |
|---------|----------------------|--------------------------|
| Authentication | Cookies + Bearer token | Bearer token only |
| CORS | Strict origin validation | No CORS headers |
| CSRF protection | Origin header required | Not needed (no browser) |
| Redirect URIs | HTTP/HTTPS origins | Custom URL schemes (`myapp://callback`) |
| Security headers | CSP, X-Frame-Options, HSTS | None (not applicable) |
| Cookie handling | HttpOnly, Secure, SameSite | No cookies |
| Demo app | demo1 Vue app | Removed |
| Admin deployment | GitHub Pages | Embedded in Worker (static assets) |

## Proxy Features

- **OAuth Token Exchange** — Exchanges authorization codes for access tokens, keeping CLIENT_SECRET server-side
- **Token Refresh** — Server-side refresh token management via Cloudflare KV
- **Token Revocation** — Clean logout with EEN token revocation and session cleanup
- **Session Management** — Server-side sessions with configurable TTL and automatic expiration
- **Custom URL Scheme Support** — Validates mobile redirect URIs like `myapp://callback` via `ALLOWED_SCHEMES`
- **Health Monitoring** — Public health endpoint (supports HEAD for uptime monitoring)
- **Rate Limiting** — Configurable per-endpoint rate limits
- **SSRF Protection** — Domain allowlist for API endpoints (`ALLOWED_API_DOMAINS`)
- **Admin Access Control** — Email-based allowlist for administrative endpoints

## Admin App Features

- **Dashboard Overview** — Real-time proxy health status and version info
- **Session Monitoring** — View count of active user sessions
- **Rate Limit Statistics** — Monitor rate limiting activity across endpoints
- **Session Management** — Remove other users' sessions while preserving your own
- **Emergency Revocation** — Revoke all tokens system-wide
- **Activity Log** — Real-time log of admin actions with timestamps
- **Dark Mode** — Persisted theme toggle
- **Resizable Panels** — Adjustable dashboard layout

## Project Structure

```
een-mobile-proxy/
├── proxy/           # Cloudflare Worker OAuth proxy
│   ├── src/
│   │   └── index.js # All proxy logic (~1350 lines)
│   ├── test/        # Vitest test suites
│   ├── scripts/     # Deploy and version scripts
│   └── wrangler.toml
├── admin/           # Vue 3 admin dashboard
│   ├── src/
│   │   ├── views/   # Login.vue, Dashboard.vue
│   │   ├── stores/  # Pinia auth store
│   │   └── services/# API service wrappers
│   └── dist/        # Built SPA (served by Worker)
└── scripts/         # Test and deploy automation
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET, HEAD | `/health` | Health check — status, version, timestamp |

### OAuth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/proxy/getAccessToken` | None (uses OAuth code) | Exchange auth code for access token. Returns `sessionId` in response body. |
| POST | `/proxy/refreshAccessToken` | Bearer token | Refresh access token using stored refresh token |
| POST | `/proxy/revoke` | Bearer token | Revoke tokens at EEN and clear session |

### Admin (requires Bearer token + admin email)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/version` | Proxy version and deploy time |
| GET | `/admin/sessionsCount` | Count active sessions |
| GET | `/admin/rateLimitStats` | Rate limiting statistics |
| DELETE | `/admin/removeSessions` | Remove all sessions except current |
| POST | `/admin/revokeAll` | Emergency: revoke all tokens |

### Mobile OAuth Flow

1. Mobile app opens EEN OAuth URL in a browser/webview with `redirect_uri=myapp://callback`
2. User authenticates with EEN
3. EEN redirects to `myapp://callback?code=AUTH_CODE`
4. App intercepts the redirect and extracts the code
5. App calls `POST /proxy/getAccessToken` with `code` and `redirect_uri`
6. Proxy returns `{ sessionId, accessToken, expiresIn, httpsBaseUrl }`
7. App stores `sessionId` and uses it for subsequent Bearer token auth

## Getting Started

### Prerequisites

- Node.js 20+
- Cloudflare account (for Worker deployment)
- EEN OAuth credentials (CLIENT_ID and CLIENT_SECRET)

### Step 1: Clone and Install

```bash
git clone https://github.com/klaushofrichter/een-mobile-proxy.git
cd een-mobile-proxy

# Install all dependencies
npm install
cd proxy && npm install && cd ..
cd admin && npm install && cd ..
```

### Step 2: Configure Environment

**Proxy** — copy and edit `proxy/.dev.vars`:
```bash
cp proxy/.dev.vars.example proxy/.dev.vars
```

Required values in `proxy/.dev.vars`:
```env
CLIENT_ID=your-een-client-id
CLIENT_SECRET=your-een-client-secret
ADMIN_EMAILS=admin@example.com
ALLOWED_SCHEMES=myapp,myotherapp
ALLOWED_API_DOMAINS=eagleeyenetworks.com
ENVIRONMENT=development
```

**Admin** — copy and edit `admin/.env`:
```bash
cp admin/.env.example admin/.env
```

Required values in `admin/.env`:
```env
VITE_EEN_CLIENT_ID=your-een-client-id
```

### Step 3: Create Cloudflare KV Namespace

```bash
cd proxy
npx wrangler kv namespace create EEN_OAUTH_SESSIONS
```

Update `proxy/wrangler.toml` with the namespace ID from the output.

### Step 4: Run Locally

Build the admin app, then start the proxy (which serves both the API and the admin SPA):

```bash
cd admin && npm run build && cd ..
cd proxy && npm run dev
```

The proxy starts at **http://127.0.0.1:3333** (configured to match the EEN OAuth redirect URI). Open this URL in your browser to access the admin dashboard.

### Step 5: Run Tests

```bash
# All tests
npm test

# Proxy tests only
cd proxy && npm test

# Admin E2E tests (requires proxy running)
cd admin && npm test
```

## Testing

### Proxy Tests (Vitest + Cloudflare Workers)

Uses Vitest with `@cloudflare/vitest-pool-workers` (Miniflare) for local testing.

```bash
cd proxy
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:perf     # Performance tests only
```

Test suites cover: OAuth flows, admin endpoints, auth headers, rate limiting, SSRF protection, security vulnerabilities, workflow integration, and performance.

### Admin Tests (Playwright)

```bash
cd admin
npm test              # E2E tests
npm run test:unit     # Unit tests
```

Requires test credentials in `admin/.env`. Destructive tests (remove sessions, revoke all) only run against localhost.

## Deployment

### Deploy Proxy to Cloudflare

Create `proxy/.env` with production secrets (same variables as `.dev.vars` plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`):

```bash
cd proxy && npm run deploy
```

The deploy script builds the admin SPA, deploys the Worker, sets secrets, and stores the version in KV.

### CI/CD

GitHub Actions workflows handle:
- AI code review (Claude + Gemini) on PRs
- Automated testing on PRs to production
- Proxy deployment to Cloudflare Workers with automatic rollback on failure
- Slack notifications for deployments and releases

## Environment Variables Reference

### Proxy (`proxy/.dev.vars` / `proxy/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `CLIENT_ID` | EEN OAuth Client ID | (required) |
| `CLIENT_SECRET` | EEN OAuth Client Secret | (required) |
| `ADMIN_EMAILS` | Comma-separated admin emails | (required) |
| `ALLOWED_SCHEMES` | Comma-separated custom URL schemes for mobile redirects | (none) |
| `ALLOWED_API_DOMAINS` | Comma-separated domains for SSRF protection | `eagleeyenetworks.com` |
| `ENVIRONMENT` | `development` or `production` | `production` |
| `REFRESH_TOKEN_TTL` | Session TTL buffer in seconds | `86400` |
| `MAX_KV_KEYS` | Max KV keys to enumerate (1000-100000) | `10000` |
| `RATE_LIMIT_ENABLED` | Enable rate limiting | `true` |
| `RATE_LIMIT_WINDOW` | Rate limit window in seconds | `60` |
| `RATE_LIMIT_HEALTH` | Max `/health` requests per window | `60` |
| `RATE_LIMIT_OAUTH` | Max `/proxy/*` requests per window | `60` |
| `RATE_LIMIT_ADMIN` | Max `/admin/*` requests per window | `60` |
| `RATE_LIMIT_UNKNOWN` | Max requests for unidentified clients | `5` |

### Admin (`admin/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_EEN_CLIENT_ID` | EEN OAuth Client ID |
| `VITE_GITHUB_REPO` | GitHub repo URL (for version links) |
| `VITE_GITHUB_BRANCH` | Git branch (for version links) |
| `ADMIN_TEST_USER` | Test admin email (Playwright) |
| `ADMIN_TEST_PASSWORD` | Test admin password (Playwright) |

## Security

- **CLIENT_SECRET** never exposed to clients
- **Refresh tokens** stored server-side only in Cloudflare KV
- **Bearer token auth** — mobile apps store `sessionId` and send via `Authorization: Bearer <sessionId>`
- **SSRF protection** — only configured domains allowed for `httpsBaseUrl`
- **Rate limiting** — configurable per-endpoint limits
- **Admin access control** — email allowlist for admin endpoints
- **Input validation** — length limits and format checks on all inputs
- **Session ID security** — cryptographically random UUIDs

## Version Management

Husky pre-commit hook auto-increments the patch version in each subfolder's `package.json` when files are modified. Proxy and admin have independent version numbers.

## Troubleshooting

### OAuth redirect fails
- Ensure `redirect_uri` matches exactly what's registered in your EEN OAuth app
- For mobile apps, verify the custom URL scheme is in `ALLOWED_SCHEMES`

### "Admin access required" error
- Ensure your email is in `ADMIN_EMAILS` (case-insensitive match)

### KV namespace not found
- Run `npx wrangler kv namespace create EEN_OAUTH_SESSIONS`
- Update `wrangler.toml` with the namespace ID

### Admin SPA not loading
- Rebuild the admin app: `cd admin && npm run build`
- Restart the proxy to pick up the new `dist/` files

## License

MIT
