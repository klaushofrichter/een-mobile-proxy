# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EEN Mobile Proxy — a Cloudflare Worker OAuth proxy for native mobile apps integrating with Eagle Eye Networks (EEN). It keeps CLIENT_SECRET server-side, stores refresh tokens in Cloudflare KV, and serves a Vue 3 admin dashboard as embedded static assets.

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

- **proxy/** — Single-file Cloudflare Worker (`src/index.js`) handling OAuth token exchange, session management, admin endpoints, rate limiting, and SSRF protection
- **admin/** — Vue 3 + Pinia + TailwindCSS 4 admin dashboard for session management, served as static assets by the Worker
- **scripts/** — Build, deploy, and test automation

The proxy is the only component with access to CLIENT_SECRET. Mobile clients communicate via header-based auth (`Authorization: Bearer <sessionId>`). No cookies are used.

### Frontend Pattern

The admin app follows this Vue 3 structure:
- **Pinia stores** (`src/stores/auth.js`) — composition API style, manage auth state, token refresh, session tracking
- **Services** (`src/services/`) — API call wrappers (auth.js, admin.js, admin.test.js)
- **CSP plugin** (`vite-plugin-csp.js`) — Vite plugin that injects `connect-src` at build time based on `VITE_PROXY_URL`
- Auth store validates `hostname` from EEN token responses against a domain allowlist before storing

## Commands

### Proxy (Cloudflare Worker)
```bash
cd proxy && npm run dev          # Start local dev server on port 3333
cd proxy && npm test             # Run all proxy tests (vitest)
cd proxy && npx vitest run test/security.test.js  # Run a single test file
cd proxy && npm run test:watch   # Watch mode
cd proxy && npm run test:perf    # Performance tests only
cd proxy && npm run deploy       # Deploy to Cloudflare
```

### Admin (Vue 3)
```bash
cd admin && npm run dev          # Vite dev server on 127.0.0.1:5173 (standalone, for UI development only)
cd admin && npm run build        # Production build (output in admin/dist, served by proxy)
cd admin && npm test             # Playwright E2E tests (builds admin, starts proxy on 3333)
cd admin && npm run test:unit    # Vitest unit tests
```

### All Tests
```bash
npm test                         # Runs scripts/run-all-tests.sh (proxy + admin sequentially)
```

## Testing

- **Proxy tests** use Vitest with `@cloudflare/vitest-pool-workers` (Miniflare). Test config is in `proxy/vitest.config.js` with mock bindings for KV, secrets, etc.
- **Frontend tests** use Playwright. The admin SPA is served by the proxy on port 3333 (not a separate Vite dev server). Playwright builds the admin app and starts the proxy automatically.
- Proxy has 12 test files covering integration, security, CORS, OAuth, admin, auth-header, rate limiting (including low-limits variant), SSRF (integration + unit), workflow, and performance.

## Key Conventions

- **Single-file worker**: All proxy logic lives in `proxy/src/index.js` (~1680 lines). No module splitting.
- **Version bumping**: Husky pre-commit hook auto-increments patch version in package.json for changed directories. It also checks proxy deployment status (skip with `SKIP_DEPLOYMENT_CHECK=1`).
- **Version numbers differ** across proxy and admin — this is intentional.
- **Environment files**: Proxy uses `.dev.vars` (secrets for both local dev and deployment). Admin uses `.env` (auto-generated from `proxy/.dev.vars` via `scripts/generate-admin-env.sh`) with `VITE_` prefix.
- **Node 20+** required (Wrangler v4, Vite 7).

## Deployment

- Proxy deploys to Cloudflare Workers via `proxy/scripts/deploy.js` (reads secrets from `proxy/.dev.vars`)
- Admin SPA is embedded in the Worker as static assets (`admin/dist/`)
- CI/CD via GitHub Actions: PR gets AI review + tests; merge to production triggers deploy with automatic rollback on failure

## Commit Message Conventions

- Use imperative mood in commit subjects (e.g., "Add cache headers" not "Added cache headers")
- Conventional commit prefixes are encouraged for automatic changelog grouping: `feat:`, `fix:`, `docs:`, `chore:`, `security:`, `ci:`
- Examples: `feat: Add OAuth PKCE support`, `fix: Prevent token refresh race condition`, `docs: Update deployment instructions`
- Commits without a prefix are still valid — they appear under "Other Changes" in release notes
- Avoid prefixing with `bump version` — the Husky pre-commit hook generates these automatically and they are excluded from changelogs

## Review Notes

- No branch protection on `develop` branch (intentional)
- Version jumps between commits are expected (not every version is committed)
