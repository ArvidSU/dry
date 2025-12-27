#!/bin/bash
set -e

echo "Verifying changes..."

bun install
bun run build
bun test


docker compose down
docker compose up --build --force-recreate -d

sleep 1

if [ -f test_dir/dry-scan.toml ]; then
  rm test_dir/dry-scan.toml
fi

# Ensure sub-config exists for testing cascading scans using the --init flag
if [ ! -f test_dir/nested/dry-scan.toml ]; then
  # Initialize with default config (this might fail because server is down, but file is created first)
  bun run src/cli.ts scan --init test_dir/nested/ || true
  
  # Update the generated config with test-specific values
  sed -i '' 's/threshold = .*/threshold = 0.95/' test_dir/nested/dry-scan.toml
  sed -i '' 's/limit = .*/limit = 5/' test_dir/nested/dry-scan.toml
  sed -i '' "s/onExceed = .*/onExceed = 'fail'/" test_dir/nested/dry-scan.toml
fi

echo "Testing cascading scan with nested config..."
# Initialize root config
bun run src/cli.ts scan --init test_dir/

# Run the scan - it should pick up the nested config for test_dir/nested
# We expect this to succeed because the nested config has threshold=0.95 and limit=5,
# and in its OWN directory it only finds 2 elements (secondLevelFunction and almostTheSameFunction),
# which doesn't exceed its limit of 5.
bun run src/cli.ts scan test_dir/

echo "Testing semantic search..."
# This should yield results if the fix is successful
bun run src/cli.ts search "function"

# ===============================
# Verifying code quality, dog food style.
# ===============================

echo "Verifying code quality by scanning the source code..."

if [ -f .dry-scan.toml ]; then
  rm .dry-scan.toml
fi

bun run src/cli.ts scan . --init
bun run src/cli.ts similar

if [ -f .dry-scan.toml ]; then
  rm .dry-scan.toml
fi

docker compose down

echo "Code quality verification complete."