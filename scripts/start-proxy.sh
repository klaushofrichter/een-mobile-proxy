#!/usr/bin/env bash
#
# Kill any process on port 3333, build admin SPA, and start the proxy dev server.
#

set -euo pipefail

PROXY_PORT=3333
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Kill any process currently using the proxy port
if pid=$(lsof -ti :"$PROXY_PORT" 2>/dev/null); then
  echo "Killing process(es) on port $PROXY_PORT: $pid"
  echo "$pid" | xargs kill -9 2>/dev/null || true
  sleep 1
else
  echo "No process found on port $PROXY_PORT"
fi

# Generate admin .env and build admin SPA
echo "Building admin SPA..."
bash "$PROJECT_ROOT/scripts/generate-admin-env.sh"
(cd "$PROJECT_ROOT/admin" && npm run build)

# Start proxy dev server
echo "Starting proxy on port $PROXY_PORT..."
cd "$PROJECT_ROOT/proxy"
npm run dev
