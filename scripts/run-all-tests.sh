#!/bin/bash
#
# Run All Tests Script
#
# This script orchestrates running all tests:
# 1. Starts the proxy locally on port 3333
# 2. Runs unit tests (vitest)
# 3. Runs integration tests against the live proxy
# 4. Cleans up all processes
#

set -e  # Exit on first error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Track if we started processes (for cleanup)
PROXY_STARTED=false

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"

    # Stop proxy on port 3333
    if [ "$PROXY_STARTED" = true ]; then
        lsof -ti :3333 | xargs kill -9 2>/dev/null || true
    fi

    echo -e "${GREEN}Cleanup complete${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Wait for a service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1

    echo -e "${BLUE}Waiting for $name to be ready at $url...${NC}"

    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}$name is ready!${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done

    echo -e "\n${RED}$name failed to start after $max_attempts seconds${NC}"
    return 1
}

# Print section header
section() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

# Track test results
UNIT_TESTS_PASSED=false
INTEGRATION_TESTS_PASSED=false

#
# Step 1: Run unit tests
#
section "Step 1: Running Unit Tests (vitest)"

cd "$ROOT_DIR/proxy"

if npm test; then
    echo -e "${GREEN}Unit tests passed!${NC}"
    UNIT_TESTS_PASSED=true
else
    echo -e "${RED}Unit tests failed!${NC}"
    exit 1
fi

#
# Step 2: Start the proxy
#
section "Step 2: Starting Proxy"

cd "$ROOT_DIR/proxy"

# Stop any existing proxy to ensure fresh state
if curl -s "http://127.0.0.1:3333/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}Stopping existing proxy on port 3333...${NC}"
    lsof -ti :3333 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo "Starting proxy..."
npm run dev > /dev/null 2>&1 &
PROXY_STARTED=true

if ! wait_for_service "http://127.0.0.1:3333/health" "Proxy"; then
    echo -e "${RED}Failed to start proxy${NC}"
    exit 1
fi

#
# Step 3: Run integration tests
#
section "Step 3: Running Integration Tests"

cd "$ROOT_DIR"

if PROXY_URL="http://127.0.0.1:3333" ./scripts/test-production-proxy.sh; then
    echo -e "${GREEN}Integration tests passed!${NC}"
    INTEGRATION_TESTS_PASSED=true
else
    echo -e "${RED}Integration tests failed!${NC}"
fi

#
# Summary
#
section "Test Summary"

echo -e "Unit Tests:        $([ "$UNIT_TESTS_PASSED" = true ] && echo -e "${GREEN}PASSED${NC}" || echo -e "${RED}FAILED${NC}")"
echo -e "Integration Tests: $([ "$INTEGRATION_TESTS_PASSED" = true ] && echo -e "${GREEN}PASSED${NC}" || echo -e "${RED}FAILED${NC}")"

# Exit with error if any tests failed
if [ "$UNIT_TESTS_PASSED" = true ] && [ "$INTEGRATION_TESTS_PASSED" = true ]; then
    echo -e "\n${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}Some tests failed!${NC}"
    exit 1
fi
