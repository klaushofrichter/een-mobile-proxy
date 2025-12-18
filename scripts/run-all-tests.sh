#!/bin/bash
#
# Run All Tests Script
#
# This script orchestrates running all tests:
# 1. Starts the proxy locally
# 2. Runs proxy API tests
# 3. Starts demo1 app and runs its Playwright tests
# 4. Starts admin app and runs its Playwright tests
# 5. Cleans up all processes
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
APP_STARTED=false

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"

    # Stop any app on port 3333
    if [ "$APP_STARTED" = true ]; then
        lsof -ti :3333 | xargs kill -9 2>/dev/null || true
    fi

    # Stop proxy on port 8787
    if [ "$PROXY_STARTED" = true ]; then
        lsof -ti :8787 | xargs kill -9 2>/dev/null || true
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
PROXY_TESTS_PASSED=false
DEMO_TESTS_PASSED=false
ADMIN_TESTS_PASSED=false

#
# Step 1: Start the proxy
#
section "Step 1: Starting Proxy"

cd "$ROOT_DIR/proxy"

# Check if proxy is already running
if curl -s "http://localhost:8787/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}Proxy is already running on port 8787${NC}"
else
    echo "Starting proxy..."
    npm run dev > /dev/null 2>&1 &
    PROXY_STARTED=true

    if ! wait_for_service "http://localhost:8787/health" "Proxy"; then
        echo -e "${RED}Failed to start proxy${NC}"
        exit 1
    fi
fi

#
# Step 2: Run proxy API tests
#
section "Step 2: Running Proxy API Tests"

cd "$ROOT_DIR/proxy"

if npm test; then
    echo -e "${GREEN}Proxy tests passed!${NC}"
    PROXY_TESTS_PASSED=true
else
    echo -e "${RED}Proxy tests failed!${NC}"
    exit 1
fi

#
# Step 3: Start demo1 app and run tests
#
section "Step 3: Running Demo App Tests"

cd "$ROOT_DIR/demo1"

# Ensure port 3333 is free
npm run stop > /dev/null 2>&1 || true

echo "Starting demo1 app..."
npm run dev > /dev/null 2>&1 &
APP_STARTED=true

if ! wait_for_service "http://127.0.0.1:3333" "Demo App"; then
    echo -e "${RED}Failed to start demo app${NC}"
    exit 1
fi

echo "Running demo1 Playwright tests..."
if npm test; then
    echo -e "${GREEN}Demo app tests passed!${NC}"
    DEMO_TESTS_PASSED=true
else
    echo -e "${RED}Demo app tests failed!${NC}"
    # Continue to admin tests even if demo tests fail
fi

# Stop demo app
echo "Stopping demo1 app..."
npm run stop > /dev/null 2>&1 || true
APP_STARTED=false

#
# Step 4: Start admin app and run tests
#
section "Step 4: Running Admin App Tests"

cd "$ROOT_DIR/admin"

# Ensure port 3333 is free
npm run stop > /dev/null 2>&1 || true

echo "Starting admin app..."
npm run dev > /dev/null 2>&1 &
APP_STARTED=true

if ! wait_for_service "http://127.0.0.1:3333" "Admin App"; then
    echo -e "${RED}Failed to start admin app${NC}"
    exit 1
fi

echo "Running admin Playwright tests..."
if npm test; then
    echo -e "${GREEN}Admin app tests passed!${NC}"
    ADMIN_TESTS_PASSED=true
else
    echo -e "${RED}Admin app tests failed!${NC}"
fi

# Stop admin app
echo "Stopping admin app..."
npm run stop > /dev/null 2>&1 || true
APP_STARTED=false

#
# Summary
#
section "Test Summary"

echo -e "Proxy API Tests:  $([ "$PROXY_TESTS_PASSED" = true ] && echo -e "${GREEN}PASSED${NC}" || echo -e "${RED}FAILED${NC}")"
echo -e "Demo App Tests:   $([ "$DEMO_TESTS_PASSED" = true ] && echo -e "${GREEN}PASSED${NC}" || echo -e "${RED}FAILED${NC}")"
echo -e "Admin App Tests:  $([ "$ADMIN_TESTS_PASSED" = true ] && echo -e "${GREEN}PASSED${NC}" || echo -e "${RED}FAILED${NC}")"

# Exit with error if any tests failed
if [ "$PROXY_TESTS_PASSED" = true ] && [ "$DEMO_TESTS_PASSED" = true ] && [ "$ADMIN_TESTS_PASSED" = true ]; then
    echo -e "\n${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}Some tests failed!${NC}"
    exit 1
fi
