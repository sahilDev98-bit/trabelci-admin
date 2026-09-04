#!/usr/bin/env bash
# Read the real, uncommitted .env in this directory and pass its VITE_*
# values through as --build-arg — the Dockerfile writes them into a fresh
# .env inside the build stage itself now (see its comment for why), so this
# script no longer relies on .env being copied into the Docker build
# context via `COPY . .` (forensic audit F-33's .dockerignore fix excludes
# it, on purpose).
set -euo pipefail

if [ ! -f .env ]; then
    echo "trabelci-admin/.env not found — copy your real one here first (see BUILD.md / .env.example)." >&2
    exit 1
fi

set -a
source .env
set +a

docker build \
  --build-arg VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
  --build-arg VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
  --build-arg VITE_ADMIN_API_BASE_URL="${VITE_ADMIN_API_BASE_URL:-}" \
  --build-arg VITE_ROOM_VISUALIZER_URL="${VITE_ROOM_VISUALIZER_URL:-}" \
  --build-arg VITE_EXTRACT_PDF_URL="${VITE_EXTRACT_PDF_URL:-}" \
  -t 1995rtc/trabelci-admin:latest .
docker push 1995rtc/trabelci-admin:latest
