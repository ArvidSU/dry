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

bun run src/cli.ts scan --init test_dir/

echo "Testing semantic search..."
# This should yield results if the fix is successful
bun run src/cli.ts search "function"

docker compose down
