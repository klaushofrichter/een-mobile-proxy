#!/usr/bin/env bash
#
# Generate admin/.env from proxy/.dev.vars
#
# proxy/.dev.vars is the single source of truth for all secrets.
# This script maps the relevant variables to admin/.env format.
#
# Usage: ./scripts/generate-admin-env.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE="$PROJECT_ROOT/proxy/.dev.vars"
TARGET="$PROJECT_ROOT/admin/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

if [ ! -f "$SOURCE" ]; then
    echo -e "${RED}Error: $SOURCE not found${NC}"
    exit 1
fi

# Read a value from the source file, stripping surrounding quotes
read_var() {
    local line
    line=$(grep "^${1}=" "$SOURCE" 2>/dev/null | head -1) || true
    if [ -z "$line" ]; then
        echo ""
        return
    fi
    local value="${line#*=}"
    value="${value#\"}"
    value="${value%\"}"
    echo "$value"
}

CLIENT_ID=$(read_var CLIENT_ID)
TEST_USER=$(read_var TEST_USER)
TEST_PASSWORD=$(read_var TEST_PASSWORD)
TEST_NON_ADMIN_USER=$(read_var TEST_NON_ADMIN_USER)
TEST_NON_ADMIN_PASSWORD=$(read_var TEST_NON_ADMIN_PASSWORD)
GITHUB_REPO=$(read_var GITHUB_REPO)
GITHUB_BRANCH=$(read_var GITHUB_BRANCH)

cat > "$TARGET" << EOF
# Auto-generated from proxy/.dev.vars — do not edit directly
# Regenerate with: ./scripts/generate-admin-env.sh

# EEN OAuth Client ID
VITE_EEN_CLIENT_ID=${CLIENT_ID}

# Admin test credentials (must be an admin user)
TEST_USER=${TEST_USER}
TEST_PASSWORD=${TEST_PASSWORD}

# Non-admin test credentials (for rejection tests)
TEST_NON_ADMIN_USER=${TEST_NON_ADMIN_USER}
TEST_NON_ADMIN_PASSWORD=${TEST_NON_ADMIN_PASSWORD}

# GitHub repository info (for version links)
VITE_GITHUB_REPO=${GITHUB_REPO}
VITE_GITHUB_BRANCH=${GITHUB_BRANCH}
EOF

echo -e "${GREEN}Generated $TARGET from $SOURCE${NC}"
