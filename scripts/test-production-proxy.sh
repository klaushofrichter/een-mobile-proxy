#!/bin/bash
#
# Mobile Proxy Integration Tests
#
# Runs integration tests against the mobile proxy to verify it's functioning
# correctly. Tests Bearer-only auth, no CORS, no browser security headers,
# and static asset serving.
#
# Usage:
#   ./scripts/test-production-proxy.sh
#   PROXY_URL=https://een-mobile-proxy.klaushofrichter.workers.dev ./scripts/test-production-proxy.sh
#   BRIEF=1 ./scripts/test-production-proxy.sh  # Compact output
#

set -e

# Check for required dependencies
for cmd in curl jq; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: Required command '$cmd' not found. Please install it first."
    exit 1
  fi
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Brief mode - compact output for CI/deployment
BRIEF="${BRIEF:-0}"

# Default to local wrangler dev
DEFAULT_PROXY_URL="http://127.0.0.1:3333"
PROXY_URL="${PROXY_URL:-$DEFAULT_PROXY_URL}"

# Track results
PASSED=0
FAILED=0

# Test function - exact match
run_test() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"

  if [ "$expected" = "$actual" ]; then
    [ "$BRIEF" = "1" ] && echo -e "${GREEN}✓${NC} $test_name" || echo -e "   ${GREEN}✅ PASSED${NC} - $test_name"
    ((PASSED++)) || true
  else
    [ "$BRIEF" = "1" ] && echo -e "${RED}✗${NC} $test_name" || echo -e "   ${RED}❌ FAILED${NC} - $test_name (expected: $expected, got: $actual)"
    ((FAILED++)) || true
  fi
}

# Test function - string contains
run_test_contains() {
  local test_name="$1"
  local needle="$2"
  local haystack="$3"

  if echo "$haystack" | grep -qi "$needle"; then
    [ "$BRIEF" = "1" ] && echo -e "${GREEN}✓${NC} $test_name" || echo -e "   ${GREEN}✅ PASSED${NC} - $test_name"
    ((PASSED++)) || true
  else
    [ "$BRIEF" = "1" ] && echo -e "${RED}✗${NC} $test_name" || echo -e "   ${RED}❌ FAILED${NC} - $test_name (missing: $needle)"
    ((FAILED++)) || true
  fi
}

# Test function - string NOT contains
run_test_not_contains() {
  local test_name="$1"
  local needle="$2"
  local haystack="$3"

  if echo "$haystack" | grep -qi "$needle"; then
    [ "$BRIEF" = "1" ] && echo -e "${RED}✗${NC} $test_name" || echo -e "   ${RED}❌ FAILED${NC} - $test_name (should not contain: $needle)"
    ((FAILED++)) || true
  else
    [ "$BRIEF" = "1" ] && echo -e "${GREEN}✓${NC} $test_name" || echo -e "   ${GREEN}✅ PASSED${NC} - $test_name"
    ((PASSED++)) || true
  fi
}

if [ "$BRIEF" = "1" ]; then
  echo -e "${BLUE}Mobile Proxy Integration Tests${NC} - $PROXY_URL"
else
  echo -e "${BLUE}============================================${NC}"
  echo -e "${BLUE}Mobile Proxy Integration Tests${NC}"
  echo -e "${BLUE}============================================${NC}"
  echo -e "URL: ${YELLOW}$PROXY_URL${NC}"
  echo ""
fi

# 1. Health check
[ "$BRIEF" != "1" ] && echo -e "${BLUE}1. Health Check${NC}"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 10 "$PROXY_URL/health" 2>/dev/null || echo -e "\n000")
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
HEALTH_STATUS=$(echo "$HEALTH_BODY" | jq -r '.status' 2>/dev/null || echo "error")
run_test "GET /health returns 200" "200" "$HEALTH_CODE"
run_test "Health status is ok" "ok" "$HEALTH_STATUS"

# 2. HEAD health
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}2. HEAD Health${NC}"
HEAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -I "$PROXY_URL/health" 2>/dev/null || echo "000")
run_test "HEAD /health returns 200" "200" "$HEAD_STATUS"

# 3. Static assets (SPA)
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}3. Static Assets (SPA)${NC}"
ROOT_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 10 "$PROXY_URL/" 2>/dev/null || echo -e "\n000")
ROOT_BODY=$(echo "$ROOT_RESPONSE" | sed '$d')
ROOT_CODE=$(echo "$ROOT_RESPONSE" | tail -1)
run_test "GET / returns 200" "200" "$ROOT_CODE"
run_test_contains "GET / returns HTML" "<html" "$ROOT_BODY"

# 4. SPA fallback
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}4. SPA Fallback${NC}"
SPA_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 10 "$PROXY_URL/dashboard" 2>/dev/null || echo -e "\n000")
SPA_BODY=$(echo "$SPA_RESPONSE" | sed '$d')
SPA_CODE=$(echo "$SPA_RESPONSE" | tail -1)
run_test "GET /dashboard returns 200 (SPA fallback)" "200" "$SPA_CODE"
run_test_contains "SPA fallback returns HTML" "<html" "$SPA_BODY"

# 5. No CORS headers
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}5. No CORS Headers${NC}"
CORS_HEADERS=$(curl -s -I --max-time 10 "$PROXY_URL/health" \
  -H "Origin: https://example.com" 2>/dev/null || echo "")
run_test_not_contains "No Access-Control-Allow-Origin header" "access-control-allow-origin" "$CORS_HEADERS"

# 6. No browser security headers
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}6. No Browser Security Headers${NC}"
SEC_HEADERS=$(curl -s -I --max-time 10 "$PROXY_URL/health" 2>/dev/null || echo "")
run_test_not_contains "No X-Frame-Options header" "x-frame-options" "$SEC_HEADERS"
run_test_not_contains "No Content-Security-Policy header" "content-security-policy" "$SEC_HEADERS"

# 7. getAccessToken exists
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}7. getAccessToken Endpoint Exists${NC}"
GAT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$PROXY_URL/proxy/getAccessToken" 2>/dev/null || echo "000")
run_test "POST /proxy/getAccessToken returns 400 (missing params, not 404)" "400" "$GAT_STATUS"

# 8. refreshAccessToken requires auth
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}8. refreshAccessToken Requires Auth${NC}"
RAT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$PROXY_URL/proxy/refreshAccessToken" 2>/dev/null || echo "000")
run_test "POST /proxy/refreshAccessToken returns 401 (no auth)" "401" "$RAT_STATUS"

# 9. revoke requires auth
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}9. Revoke Requires Auth${NC}"
REVOKE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$PROXY_URL/proxy/revoke" 2>/dev/null || echo "000")
run_test "POST /proxy/revoke returns 401 (no auth)" "401" "$REVOKE_STATUS"

# 10. Invalid Bearer rejected
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}10. Invalid Bearer Rejected${NC}"
INVALID_BEARER=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$PROXY_URL/proxy/refreshAccessToken" \
  -H "Authorization: Bearer invalid-session" 2>/dev/null || echo "000")
run_test "Invalid Bearer token rejected with 401" "401" "$INVALID_BEARER"

# 11. Admin version requires auth
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}11. Admin Version Requires Auth${NC}"
ADMIN_VERSION=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PROXY_URL/admin/version" 2>/dev/null || echo "000")
run_test "GET /admin/version returns 401 (no auth)" "401" "$ADMIN_VERSION"

# 12. Admin sessionsCount requires auth
[ "$BRIEF" != "1" ] && echo -e "\n${BLUE}12. Admin Sessions Count Requires Auth${NC}"
ADMIN_SESSIONS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PROXY_URL/admin/sessionsCount" 2>/dev/null || echo "000")
run_test "GET /admin/sessionsCount returns 401 (no auth)" "401" "$ADMIN_SESSIONS"

# Summary
if [ "$BRIEF" = "1" ]; then
  if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All $PASSED tests passed${NC}"
    exit 0
  else
    echo -e "${RED}$FAILED failed${NC}, ${GREEN}$PASSED passed${NC}"
    exit 1
  fi
else
  echo -e "\n${BLUE}============================================${NC}"
  echo -e "${BLUE}Test Summary${NC}"
  echo -e "${BLUE}============================================${NC}"
  echo -e "Passed: ${GREEN}$PASSED${NC}"
  echo -e "Failed: ${RED}$FAILED${NC}"

  if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}All tests passed!${NC}"
    exit 0
  else
    echo -e "\n${RED}Some tests failed!${NC}"
    exit 1
  fi
fi
