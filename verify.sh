#!/bin/bash
set -e

echo "Verifying changes..."

bun install
bun run build
bun test


docker compose down
docker compose up --build --force-recreate -d

dry scan test_dir

docker compose down