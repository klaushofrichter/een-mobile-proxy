#!/bin/bash

# Script to check if proxy deployment is needed
# This can be run manually or in CI/CD
#
# Environment variables:
#   PROXY_URL              - Override proxy URL (default: production)

set -euo pipefail

# Check node is available (required for JSON parsing)
if ! command -v node &> /dev/null; then
    echo "Error: node is required but not installed"
    exit 1
fi

PROXY_URL="${PROXY_URL:-https://een-mobile-proxy.klaushofrichter.workers.dev}"

# Validate PROXY_URL format to prevent command injection
if [[ ! "$PROXY_URL" =~ ^https?:// ]]; then
    echo "Error: Invalid PROXY_URL format. Must start with http:// or https://"
    exit 1
fi

echo "========================================"
echo "  Proxy Deployment Check"
echo "========================================"

# Get the local version
if [ ! -f "proxy/package.json" ]; then
    echo "Error: proxy/package.json not found."
    exit 1
fi
local_version=$(node -p "require('./proxy/package.json').version" 2>/dev/null)

# Try to get deployed version from health endpoint
# --max-redirs 0 prevents following redirects for security
health_response=$(curl -s --max-redirs 0 --connect-timeout 5 --max-time 10 "$PROXY_URL/health" 2>/dev/null)

if [ -n "$health_response" ]; then
    # Parse version using node with proper stdin handling
    deployed_version=$(echo "$health_response" | node -e "
        let data = '';
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => {
            try {
                const version = JSON.parse(data).version.split(' - ')[1];
                if (version) console.log(version);
            } catch(e) {}
        });
    " 2>/dev/null)
fi

if [ -n "$deployed_version" ]; then
    echo "  Local version:    v$local_version"
    echo "  Deployed version: v$deployed_version"

    if [ "$local_version" != "$deployed_version" ]; then
        echo ""
        echo "  ⚠️  DEPLOYMENT NEEDED"
        echo "  Local version differs from deployed version."
        echo "  Run 'cd proxy && npm run deploy'"
        exit 1
    else
        echo ""
        echo "  ✅  Deployment up to date"
    fi
else
    echo "  Local version: v$local_version"
    echo "  ⚠️  Could not fetch deployed version (network timeout or error)"
    echo "  Please check manually."
    exit 1
fi

echo "========================================"
echo ""
