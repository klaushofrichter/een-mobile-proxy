#!/usr/bin/env bash
#
# Upload secrets from proxy/.dev.vars to GitHub repository secrets
#
# Usage: ./scripts/upload-github-secrets.sh
#
# Requires: GitHub CLI (gh) authenticated with repo access
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/proxy/.dev.vars"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "Upload Secrets to GitHub Repository"
echo "=========================================="

# Check gh CLI is installed and authenticated
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI is not authenticated. Run 'gh auth login' first.${NC}"
    exit 1
fi

# Check .dev.vars file exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: $ENV_FILE not found${NC}"
    exit 1
fi

echo "Reading secrets from: $ENV_FILE"
echo ""

# Function to upload a secret
upload_secret() {
    local gh_secret_name="$1"
    local env_var_name="$2"

    # Extract value from .env file (handles both quoted and unquoted values)
    # Uses cut -d'=' -f2- to handle values containing '=' characters
    local line=$(grep "^${env_var_name}=" "$ENV_FILE" 2>/dev/null | head -1)

    if [ -z "$line" ]; then
        echo -e "${YELLOW}⚠ Skipping $gh_secret_name - $env_var_name not found in .dev.vars${NC}"
        return
    fi

    # Extract value after first '=' and strip surrounding quotes
    # Note: This simple quote stripping doesn't handle escaped quotes within values.
    # If your secrets contain literal \" sequences, edit them manually via GitHub UI.
    local value="${line#*=}"
    value="${value#\"}"
    value="${value%\"}"

    if [ -z "$value" ]; then
        echo -e "${YELLOW}⚠ Skipping $gh_secret_name - $env_var_name has empty value${NC}"
        return
    fi

    # Warn if value contains newlines (not supported)
    if [[ "$value" == *$'\n'* ]]; then
        echo -e "${RED}✗ $gh_secret_name contains newlines (not supported)${NC}"
        return 1
    fi

    echo -n "Uploading $gh_secret_name... "
    if echo "$value" | gh secret set "$gh_secret_name" 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗ Failed${NC}"
        return 1
    fi
}

# Upload Cloudflare secrets (new)
echo "--- Cloudflare Deployment Secrets ---"
upload_secret "CLOUDFLARE_API_TOKEN" "CLOUDFLARE_API_TOKEN"
upload_secret "CLOUDFLARE_ACCOUNT_ID" "CLOUDFLARE_ACCOUNT_ID"

echo ""
echo "--- OAuth Secrets (mapped names) ---"
upload_secret "VITE_EEN_CLIENT_ID" "CLIENT_ID"
upload_secret "EEN_CLIENT_SECRET" "CLIENT_SECRET"

echo ""
echo "--- Test Credentials ---"
upload_secret "TEST_USER" "TEST_USER"
upload_secret "TEST_PASSWORD" "TEST_PASSWORD"
upload_secret "TEST_NON_ADMIN_USER" "TEST_NON_ADMIN_USER"
upload_secret "TEST_NON_ADMIN_PASSWORD" "TEST_NON_ADMIN_PASSWORD"
# The test user must be in ADMIN_EMAILS to have admin access for admin app tests

echo ""
echo "--- API Keys ---"
upload_secret "ANTHROPIC_API_KEY" "ANTHROPIC_API_KEY"
upload_secret "GEMINI_API_KEY" "GEMINI_API_KEY"

echo ""
echo "--- Proxy Configuration ---"
upload_secret "ADMIN_EMAILS" "ADMIN_EMAILS"
upload_secret "ALLOWED_SCHEMES" "ALLOWED_SCHEMES"
upload_secret "ALLOWED_API_DOMAINS" "ALLOWED_API_DOMAINS"
upload_secret "ENVIRONMENT" "ENVIRONMENT"
upload_secret "REFRESH_TOKEN_TTL" "REFRESH_TOKEN_TTL"
upload_secret "MAX_KV_KEYS" "MAX_KV_KEYS"

echo ""
echo "--- Notifications ---"
upload_secret "SLACK_WEBHOOK" "SLACK_WEBHOOK"

echo ""
echo "=========================================="
echo -e "${GREEN}Secret upload complete!${NC}"
echo "=========================================="
echo ""
echo "Verify with: gh secret list"
