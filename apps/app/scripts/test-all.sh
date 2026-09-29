#!/bin/bash

# Script to run all tests locally before pushing
# Usage: ./scripts/test-all.sh

set -e # Exit on error

echo "🧪 Running all tests..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from apps/app directory${NC}"
    exit 1
fi

echo -e "${YELLOW}1. Running type check...${NC}"
if pnpm run typecheck; then
    echo -e "${GREEN}✓ Type check passed${NC}"
else
    echo -e "${RED}✗ Type check failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}2. Running linter...${NC}"
if pnpm run lint; then
    echo -e "${GREEN}✓ Linting passed${NC}"
else
    echo -e "${RED}✗ Linting failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}3. Running unit tests...${NC}"
if pnpm exec vitest run; then
    echo -e "${GREEN}✓ Unit tests passed${NC}"
else
    echo -e "${RED}✗ Unit tests failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}4. Running E2E tests (Chromium only for speed)...${NC}"
echo "Starting dev server..."

# Start dev server in background
pnpm run dev &
DEV_PID=$!

# Wait for server to be ready
echo "Waiting for server to start..."
sleep 10

# Function to cleanup on exit
cleanup() {
    echo "Cleaning up..."
    kill $DEV_PID 2>/dev/null || true
}
trap cleanup EXIT

# Check if server is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo -e "${RED}✗ Dev server failed to start${NC}"
    exit 1
fi

# Run E2E tests
if pnpm exec playwright test --project=chromium; then
    echo -e "${GREEN}✓ E2E tests passed${NC}"
else
    echo -e "${RED}✗ E2E tests failed${NC}"
    echo "Run 'pnpm run test:e2e:ui' to debug"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ All tests passed! Ready to push.${NC}" 