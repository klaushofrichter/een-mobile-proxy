# EEN OAuth Proxy

A standalone OAuth proxy system for Eagle Eye Networks (EEN) consisting of three independent applications.

## Project Structure

```
een-oauth-proxy/
├── proxy/       # Cloudflare Worker OAuth proxy
├── admin/       # Vue 3 management application
└── demo1/       # Vue 3 demo application
```

## Components

### Proxy (`./proxy`)

A Cloudflare Worker that handles OAuth authentication with EEN services. It keeps the CLIENT_ID and CLIENT_SECRET secure on the server side, never exposing them to the frontend.

**Features:**
- OAuth token exchange (`/proxy/getAccessToken`)
- Token refresh (`/proxy/refreshAccessToken`)
- Token revocation (`/proxy/revoke`)
- Admin endpoints for session management

**Deployment:** Cloudflare Workers at `https://een-oauth-proxy.klaushofrichter.workers.dev`

### Admin App (`./admin`)

A Vue 3 management application for monitoring and administering the OAuth proxy.

**Features:**
- View proxy version and deployment info
- Monitor active sessions
- Remove sessions (except current)
- Emergency token revocation

**Deployment:** GitHub Pages at `https://klaushofrichter.github.io/een-oauth-proxy/admin/`

### Demo App (`./demo1`)

A Vue 3 demonstration application showing OAuth integration with EEN.

**Features:**
- OAuth login via EEN
- Direct login with access token
- User profile display
- Token refresh and revocation
- Auto-refresh before token expiration

**Deployment:** GitHub Pages at `https://klaushofrichter.github.io/een-oauth-proxy/demo1/`

## Getting Started

### Prerequisites

- Node.js 20+ (required for Wrangler v4 and Vite 7)
- npm
- Cloudflare account (for proxy deployment)
- GitHub account (for Pages deployment)
- EEN OAuth credentials (CLIENT_ID and CLIENT_SECRET)

### Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/klaushofrichter/een-oauth-proxy.git
cd een-oauth-proxy

# Install root dependencies (Husky for git hooks)
npm install

# Install proxy dependencies
cd proxy && npm install && cd ..

# Install demo app dependencies
cd demo1 && npm install && cd ..

# Install admin app dependencies
cd admin && npm install && cd ..
```

### Step 2: Configure Environment Variables

Each subfolder has its own `.env.example` file. Copy and configure each one:

**Proxy (`./proxy/.env`):**
```bash
cd proxy
cp .env.example .env
```

Edit `proxy/.env`:
```env
CLIENT_ID=your-een-client-id
CLIENT_SECRET=your-een-client-secret
ADMIN_EMAILS=admin@example.com
ALLOWED_ORIGINS=https://klaushofrichter.github.io,http://localhost:5173
ENVIRONMENT=development
```

**Demo App (`./demo1/.env`):**
```bash
cd demo1
cp .env.example .env
```

Edit `demo1/.env`:
```env
VITE_PROXY_URL=http://localhost:8787
VITE_EEN_CLIENT_ID=your-een-client-id
VITE_EEN_AUTH_URL=https://auth.eagleeyenetworks.com/oauth2/authorize
VITE_REDIRECT_URI=http://localhost:5173/
```

**Admin App (`./admin/.env`):**
```bash
cd admin
cp .env.example .env
```

Edit `admin/.env`:
```env
VITE_PROXY_URL=http://localhost:8787
VITE_EEN_CLIENT_ID=your-een-client-id
VITE_EEN_AUTH_URL=https://auth.eagleeyenetworks.com/oauth2/authorize
VITE_REDIRECT_URI=http://localhost:5174/
```

### Step 3: Create Cloudflare KV Namespace

The proxy uses Cloudflare KV to store session data. Create a namespace:

```bash
cd proxy
npx wrangler kv:namespace create "EEN_OAUTH_SESSIONS"
```

This will output something like:
```
{ binding = "EEN_OAUTH_SESSIONS", id = "abcd1234..." }
```

Update `proxy/wrangler.toml` with the namespace ID:
```toml
[[kv_namespaces]]
binding = "EEN_OAUTH_SESSIONS"
id = "abcd1234..."  # Use your actual ID
```

### Step 4: Run Locally

Open three terminal windows:

**Terminal 1 - Proxy (port 8787):**
```bash
cd proxy
npm run dev
```

**Terminal 2 - Demo App (port 5173):**
```bash
cd demo1
npm run dev
```

**Terminal 3 - Admin App (port 5174):**
```bash
cd admin
npm run dev
```

Now you can access:
- Demo App: http://localhost:5173
- Admin App: http://localhost:5174
- Proxy: http://localhost:8787

### Step 5: Run Tests

```bash
cd proxy
npm test
```

## Deployment

### Deploy Proxy to Cloudflare

Before deploying, ensure your `wrangler.toml` has the KV namespace configured.

```bash
cd proxy
npm run deploy
```

Or from root:
```bash
npm run deploy:proxy
```

The deploy script will:
1. Deploy the worker to Cloudflare
2. Set secrets (CLIENT_ID, CLIENT_SECRET, ADMIN_EMAILS, ALLOWED_ORIGINS)
3. Store the version in KV

### Deploy Apps to GitHub Pages

Update the `.env` files for production:

**demo1/.env:**
```env
VITE_PROXY_URL=https://een-oauth-proxy.klaushofrichter.workers.dev
VITE_REDIRECT_URI=https://klaushofrichter.github.io/een-oauth-proxy/demo1/
```

**admin/.env:**
```env
VITE_PROXY_URL=https://een-oauth-proxy.klaushofrichter.workers.dev
VITE_REDIRECT_URI=https://klaushofrichter.github.io/een-oauth-proxy/admin/
```

Then deploy:
```bash
npm run deploy:pages
```

Or directly:
```bash
./scripts/deploy-pages.sh
```

## Environment Variables Reference

### Proxy Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CLIENT_ID` | EEN OAuth Client ID | `PREVIEW-KLAUS-MOBILE` |
| `CLIENT_SECRET` | EEN OAuth Client Secret | `your-secret` |
| `ADMIN_EMAILS` | Comma-separated admin emails | `admin@example.com` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `https://example.com` |
| `ENVIRONMENT` | `development` or `production` | `development` |

### App Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_PROXY_URL` | URL of the OAuth proxy | `http://localhost:8787` |
| `VITE_EEN_CLIENT_ID` | EEN OAuth Client ID | `PREVIEW-KLAUS-MOBILE` |
| `VITE_EEN_AUTH_URL` | EEN OAuth authorize URL | `https://auth.eagleeyenetworks.com/oauth2/authorize` |
| `VITE_REDIRECT_URI` | OAuth callback URL | `http://localhost:5173/` |

## API Endpoints

### OAuth Endpoints (Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/proxy/getAccessToken` | POST | Exchange authorization code for tokens |
| `/proxy/refreshAccessToken` | POST | Refresh access token |
| `/proxy/revoke` | POST | Revoke tokens and clear session |
| `/health` | GET | Health check |

### Admin Endpoints (Require Admin Authentication)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/version` | GET | Get proxy version and deploy time |
| `/admin/sessionsCount` | GET | Get count of active sessions |
| `/admin/removeSessions` | DELETE | Remove all sessions except current |
| `/admin/revokeAll` | POST | Revoke all tokens (emergency) |

## Version Management

This project uses Husky to automatically increment the patch version in each subfolder's `package.json` when files in that subfolder are committed.

For example, if you modify files in `proxy/`, the `proxy/package.json` version will be incremented from `0.1.0` to `0.1.1` on commit.

## Security

- **CLIENT_SECRET** is never exposed to the frontend
- **Refresh tokens** are stored server-side only in Cloudflare KV
- **Session cookies** are HttpOnly, Secure, and SameSite=None
- **CORS validation** on all proxy requests
- **Admin endpoints** require email verification against allowlist
- **Automatic token expiration** via KV TTL

## Troubleshooting

### "Forbidden: Invalid origin" error
- Check that the request origin is in `ALLOWED_ORIGINS`
- In development, localhost origins are automatically allowed

### "Admin access required" error
- Ensure your email is in the `ADMIN_EMAILS` list
- The email must match exactly (case-insensitive)

### KV namespace not found
- Run `npx wrangler kv:namespace create "EEN_OAUTH_SESSIONS"`
- Update `wrangler.toml` with the namespace ID

### OAuth callback fails
- Verify `VITE_REDIRECT_URI` matches your EEN OAuth app configuration
- Check that the proxy is running and accessible

## License

MIT
