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

docker compose down