---
title: EEN OAuth Proxy - Repository Overview
description: A comprehensive presentation covering the architecture, security, testing, and CI/CD of the EEN OAuth Proxy project
marp: true
theme: default
size: 16:9
transition: none
paginate: true
style: |
  section {
    font-size: 20px;
    padding: 30px;
  }
  h1 { font-size: 40px; color: #1a73e8; }
  h2 { font-size: 30px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
  table { font-size: 18px; width: 100%; }
  code { font-size: 0.85em; }
  h1, h2 { text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
---

# EEN OAuth Proxy
## Repository Overview & Architecture Analysis

[GitHub Repository]({{REPO_URL}})

---

# Core Functionality

**What does this software do?**

- **OAuth Proxy Service**: A standalone proxy for Eagle Eye Networks (EEN) authentication
- **Secure Token Management**:
  - Exchanges authorization codes for access tokens
  - Stores `CLIENT_SECRET` and refresh tokens server-side (Cloudflare KV)
  - Never exposes sensitive credentials to the frontend
- **Session Handling**: Manages user sessions with automatic refresh and revocation
- **Admin Interface**: Vue 3 application for health monitoring, session management, and administrative actions
- **Demo Application**: Vue 3 reference implementation showing OAuth integration patterns

---

# Software Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Eagle Eye Networks                              │
│                         (OAuth Provider & Video API)                         │
└───────────────────────────────────▲─────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    │
┌───────────────────────────────────┴─────────────────────────────────────────┐
│                     Cloudflare Edge Network (Global)                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    OAuth Proxy Worker (proxy/)                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────────┐   │ │
│  │  │ /proxy/*     │  │ /admin/*     │  │    Cloudflare KV Storage    │   │ │
│  │  │ OAuth Flows  │  │ Admin APIs   │  │  - Session Data             │   │ │
│  │  │ - getToken   │  │ - version    │  │  - Refresh Tokens           │   │ │
│  │  │ - refresh    │  │ - sessions   │  │  - Rate Limit Counters      │   │ │
│  │  │ - revoke     │  │ - revokeAll  │  │  - Version/Deploy Info      │   │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────▲─────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
     ┌──────┴──────┐         ┌──────┴──────┐         ┌──────┴──────┐
     │   admin/    │         │   demo1/    │         │   Mobile    │
     │  Vue 3 SPA  │         │  Vue 3 SPA  │         │   Clients   │
     │ GitHub Pages│         │   (Local)   │         │ (Header Auth│
     └─────────────┘         └─────────────┘         └─────────────┘
```

---

# Repository Structure

```
een-oauth-proxy/
├── proxy/                    # Cloudflare Worker Backend
│   ├── src/index.js         # Main worker code (OAuth, Admin, Rate Limiting)
│   ├── test/                # Test suites (13 test files)
│   │   ├── oauth.test.js    # Token exchange tests
│   │   ├── security.test.js # Security vulnerability tests
│   │   ├── cors.test.js     # CORS validation tests
│   │   └── ...
│   ├── wrangler.toml        # Cloudflare configuration
│   └── scripts/deploy.js    # Deployment script
├── admin/                    # Admin Dashboard (Vue 3)
│   ├── src/
│   │   ├── views/           # Login.vue, Dashboard.vue
│   │   └── App.vue
│   ├── tests/               # Playwright E2E tests
│   └── vite.config.js
├── demo1/                    # Demo Application (Vue 3)
│   ├── src/
│   │   ├── views/           # Login.vue, Profile.vue, Direct.vue
│   │   └── App.vue
│   └── tests/               # Playwright E2E tests
├── .github/workflows/        # CI/CD Pipelines (11 workflows)
├── scripts/                  # Build & deployment scripts
└── package.json              # Root package with Husky hooks
```

---

# Branches & GitHub Actions

**Branch Management Strategy**

- **`develop`**: Active development branch - all feature work merges here
- **`production`**: Stable, deployable branch - protected with strict rules
- **Flow**: `feature/*` → `develop` → `production`

**Branch Protection Rules (production):**
- Direct pushes blocked - PRs required
- Required status checks:
  - AI code reviews (Claude & Gemini)
  - Playwright E2E tests
  - CodeQL security scanning
- No bypass for administrators

---

# GitHub Actions Workflows

| Workflow | Trigger | Function |
|----------|---------|----------|
| `pr-review.yml` | PR to production/develop | Claude AI code review |
| `pr-review-gemini.yml` | PR to production | Gemini AI security review |
| `test-admin-pr.yml` | PR to production | Playwright E2E tests (admin) |
| `test-demo1-pr.yml` | PR to production | Playwright E2E tests (demo1) |
| `codeql.yml` | PR to production | CodeQL vulnerability scanning |
| `deploy-admin.yml` | Push to production | Deploy admin to GitHub Pages |
| `test-admin-deployed.yml` | After deploy | Tests deployed admin app |
| `release.yml` | After deploy tests | Creates semantic release |
| `sync-develop.yml` | PR merged | Syncs production → develop |
| `check-proxy-version.yml` | Manual | Validates proxy deployment |
| `validate-branch-protection.yml` | Manual | Validates branch rules |

---

# Testing Strategy

**Comprehensive multi-layer testing approach:**

**Proxy (Backend) - Vitest + Cloudflare Workers Pool:**

| Test File | Purpose |
|-----------|---------|
| `oauth.test.js` | Token exchange, refresh, revocation |
| `security.test.js` | Injection attacks, XSS, CSRF |
| `cors.test.js` | Origin validation, preflight |
| `admin.test.js` | Admin authentication/authorization |
| `rate-limiting.test.js` | Rate limit enforcement |
| `performance.test.js` | Performance benchmarks |
| `auth-header.test.js` | Bearer token authentication |
| `integration.test.js` | EEN API communication |
| `workflow.test.js` | End-to-end OAuth flows |

---

# Testing - Frontend & Coverage

**Frontend Apps - Playwright E2E:**

| App | Test Files | Coverage |
|-----|------------|----------|
| admin/ | `admin-login.spec.js`, `admin-destructive.spec.js` | Login, dashboard, session management |
| demo1/ | `happy-path.spec.js`, `auth-flows.spec.js` | OAuth flow, token refresh, logout |

**Test Environment:**
- All tests run automatically on PRs to production
- Destructive tests only run against local proxy (safety guard)
- Integration tests require valid EEN credentials
- Tests use real OAuth flows (not mocked)

**Running Tests:**
```bash
npm test              # Run all tests (proxy + admin + demo1)
npm run test:proxy    # Proxy unit/integration tests only
npm run test:admin    # Admin Playwright tests only
npm run test:demo     # Demo1 Playwright tests only
```

---

# Security Measures

**Defensive Architecture:**

| Layer | Protection |
|-------|-----------|
| Transport | HTTPS only, HSTS headers (production) |
| Rate Limiting | Per-endpoint limits (5-60 req/min by type) |
| Token Safety | CLIENT_SECRET server-side only, refresh tokens in KV |
| Headers | X-Content-Type-Options, X-Frame-Options, CSP |
| Cookies | `HttpOnly`, `Secure`, `SameSite=None` |
| Validation | Strict input validation, origin checking (CORS/CSRF) |
| Admin Access | Email-based allowlist |
| Redirects | Open redirect prevention |
| Timing | Constant-time comparisons for sensitive operations |

---

# Security - Vulnerability Testing

**Security Tests Include:**
- SQL/NoSQL injection attempts
- XSS payload handling
- Command injection attempts
- Path traversal attacks
- Session ID manipulation
- CORS bypass attempts
- HTTP method validation
- Header injection prevention
- Rate limiting enforcement
- JSON parsing edge cases

**Current Vulnerability Status:**
- **0 Known Vulnerabilities** (as of last audit)
- CodeQL analysis on every PR
- Dual AI security review (Claude + Gemini)
- Dependencies regularly audited

---

# Security - Development Process Guards

**Automated Security Scanning:**
- **CodeQL**: Static analysis for JavaScript/TypeScript vulnerabilities
- **Gemini AI Review**: Security-focused code analysis with risk assessment
- **Claude AI Review**: Code quality and security best practices

**Development Workflow Guards:**
- Branch protection prevents unverified code reaching production
- Required status checks must pass before merge
- No admin bypass for production branch
- Husky pre-commit hooks for local validation

**Security Headers Applied:**
- `Content-Security-Policy` (CSP)
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

---

# Documentation Structure

| Location | Content |
|----------|---------|
| `README.md` | Complete project overview, setup guide, API reference |
| `DEPENDENCY_AUDIT.md` | Dependency analysis and security status |
| `.github/BRANCH_PROTECTION.md` | Branch protection rules documentation |
| `.github/claude-review.md` | AI reviewer custom prompts |
| `.github/workflows/` | CI/CD pipeline definitions (11 workflows) |
| `.claude/skills/` | Claude Code automation skills |
| `proxy/src/index.js` | Inline documentation for complex logic |

**Key Characteristics:**
- Single comprehensive README (700+ lines)
- Inline JSDoc comments for all functions
- Workflow documentation embedded in YAML files

---

# Recommended Improvements

**Dependency Management:**
1. Standardize `dotenv` versions across workspaces
2. Consider npm workspaces for shared dependency management
3. Implement Dependabot or Renovate for automated updates

**Testing Enhancements:**
1. Fix `node:inspector` compatibility for coverage reporting
2. Add mutation testing for critical security paths
3. Add performance regression tests to CI pipeline

**Documentation:**
1. Add API documentation generation (OpenAPI/Swagger)
2. Create troubleshooting runbook for common issues

**Architecture:**
1. Consider adding request tracing/correlation IDs
2. Add structured logging for better observability

---

# Key Packages & Components

**Backend (proxy/)**
| Package | Version | Purpose |
|---------|---------|---------|
| `wrangler` | 4.55 | Cloudflare Workers CLI & dev server |
| `vitest` | 3.2 | Testing framework |
| `@cloudflare/vitest-pool-workers` | 0.9 | Workers test environment |

**Frontend (admin/ & demo1/)**
| Package | Version | Purpose |
|---------|---------|---------|
| `vue` | 3.5 | Reactive UI framework |
| `vite` | 7.3 | Build tool & dev server |
| `pinia` | 3.0 | State management |
| `vue-router` | 4.6 | Client-side routing |
| `tailwindcss` | 4.1 | Utility-first CSS |
| `@playwright/test` | 1.57 | E2E testing |

---

# Current Component Versions

| Component | Version | Description |
|-----------|---------|-------------|
| `proxy` | 1.2.16 | Cloudflare Worker OAuth API |
| `admin` | 1.0.36 | Admin dashboard application |
| `demo1` | 0.0.41 | Demo client application |

**Version Management:**
- Husky pre-commit hooks auto-increment patch versions
- Version stored in KV on proxy deploy
- Version displayed in app footers with GitHub links
- GitHub Releases created automatically after successful deploys
- Slack notifications sent on deployments

---

# API Endpoints Summary

**Public:**
- `GET/HEAD /health` - Health check (monitoring-friendly)

**OAuth (session required for refresh/revoke):**
- `POST /proxy/getAccessToken` - Exchange auth code for tokens
- `POST /proxy/refreshAccessToken` - Refresh access token
- `POST /proxy/revoke` - Revoke tokens and clear session

**Admin (admin email required):**
- `GET /admin/version` - Proxy version info
- `GET /admin/sessionsCount` - Active session count
- `GET /admin/rateLimitStats` - Rate limiting statistics
- `DELETE /admin/removeSessions` - Remove other sessions
- `POST /admin/revokeAll` - Emergency: revoke all tokens

---

# Summary

**EEN OAuth Proxy** is a production-ready OAuth implementation featuring:

- **Secure Architecture**: Server-side secret management, encrypted sessions
- **Comprehensive Testing**: 13 test files covering unit, integration, security, E2E
- **Automated CI/CD**: 11 workflows including AI review, security scanning, auto-deploy
- **Modern Stack**: Vue 3, Vite 7, Cloudflare Workers, Playwright
- **Developer Experience**: Claude Code skills, Husky hooks, comprehensive docs

**Repository:** [{{REPO_URL}}]({{REPO_URL}})

---

# Questions?

**Resources:**
- GitHub Repository: [{{REPO_URL}}]({{REPO_URL}})
- Eagle Eye Networks: [developer.eagleeyenetworks.com](https://developer.eagleeyenetworks.com/)
- Cloudflare Workers: [developers.cloudflare.com/workers](https://developers.cloudflare.com/workers/)

**Contact:**
- Open an issue on GitHub for questions or feedback
