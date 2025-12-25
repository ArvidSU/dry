#!/bin/bash
set -e

echo "Verifying changes..."

bun install

bun test

bun run link

docker compose down
docker compose up --build --force-recreate -d

dry scan test_dir

docker compose down