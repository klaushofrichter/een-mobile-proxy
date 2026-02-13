# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EEN OAuth Proxy — a Cloudflare Worker that securely handles OAuth authentication with Eagle Eye Networks (EEN). It keeps CLIENT_SECRET server-side, stores refresh tokens in Cloudflare KV, and serves two Vue 3 frontend apps (admin + demo1) deployed to GitHub Pages.

## Architecture

```
GitHub Pages (admin & demo1 Vue apps)
        │ HTTPS + CORS
        ▼
Cloudflare Worker (proxy/src/index.js)
   ├── Cloudflare KV (session/token storage)
   └── EEN OAuth API (eagleeyenetworks.com)
```

- **proxy/** — Single-file Cloudflare Worker (`src/index.js`) handling OAuth token exchange, session management, admin endpoints, rate limiting, and SSRF protection
- **admin/** — Vue 3 + Pinia + TailwindCSS 4 admin dashboard for session management
- **demo1/** — Vue 3 + Pinia + TailwindCSS 4 demo app showing OAuth login flow
- **scripts/** — Build, deploy, and test automation

The proxy is the only component with access to CLIENT_SECRET. Frontend apps communicate via session cookies (HttpOnly, Secure, SameSite=None) or header-based auth.

## Commands

### Proxy (Cloudflare Worker)
```bash
cd proxy && npm run dev          # Start local dev server on port 8787
cd proxy && npm test             # Run all proxy tests (vitest)
cd proxy && npx vitest run test/security.test.js  # Run a single test file
cd proxy && npm run test:watch   # Watch mode
cd proxy && npm run test:perf    # Performance tests only
cd proxy && npm run deploy       # Deploy to Cloudflare
```

### Admin (Vue 3)
```bash
cd admin && npm run dev          # Dev server on 127.0.0.1:3333
cd admin && npm run dev:prod     # Dev server with production config
cd admin && npm run build        # Production build
cd admin && npm test             # Playwright E2E tests
cd admin && npm run test:unit    # Vitest unit tests
```

### Demo1 (Vue 3)
```bash
cd demo1 && npm run dev          # Dev server on 127.0.0.1:3333
cd demo1 && npm run dev:prod     # Dev server with production config
cd demo1 && npm run build        # Production build
cd demo1 && npm test             # Playwright E2E tests
```

### All Tests
```bash
npm test                         # Runs scripts/run-all-tests.sh (proxy + demo1 + admin sequentially)
```

Admin and demo1 share port 3333 — they cannot run simultaneously (this is intentional due to OAuth redirect URI constraints).

## Testing

- **Proxy tests** use Vitest with `@cloudflare/vitest-pool-workers` (Miniflare). Test config is in `proxy/vitest.config.js` with mock bindings for KV, secrets, etc.
- **Frontend tests** use Playwright. They require the proxy running on port 8787 and the app on port 3333.
- Proxy has 17 test files covering integration, security, CORS, OAuth, admin, rate limiting, SSRF, and performance.

## Key Conventions

- **Single-file worker**: All proxy logic lives in `proxy/src/index.js` (~1400 lines). No module splitting.
- **Version bumping**: Husky pre-commit hook auto-increments patch version in package.json for changed directories.
- **Version numbers differ** across proxy, admin, and demo1 — this is intentional.
- **Environment files**: Proxy uses `.dev.vars` (local secrets) and `.env` (deploy secrets). Frontend apps use `.env` and `.env.prod` with `VITE_` prefix.
- **Node 20+** required (Wrangler v4, Vite 7).

## Deployment

- Proxy deploys to Cloudflare Workers via `proxy/scripts/deploy.js` (reads secrets from `proxy/.env`)
- Admin/demo1 deploy to GitHub Pages under `/een-oauth-proxy/` and `/een-oauth-proxy/demo1/`
- CI/CD via GitHub Actions: PR gets AI review + tests; merge to production triggers deploy with automatic rollback on failure

## Review Notes

- No branch protection on `develop` branch (intentional)
- Version jumps between commits are expected (not every version is committed)
- Admin and demo1 sharing port 3333 is by design
