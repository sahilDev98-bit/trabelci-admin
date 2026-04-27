#!/usr/bin/env bash
set -e

echo "Listing existing containers..."
docker ps -a || true

echo "Stopping and removing existing admin and backend containers (if any)..."
docker stop admin-panel || true
docker rm admin-panel || true

docker stop backend-service || true
docker rm backend-service || true

echo "Current images:"
docker images || true

echo "Removing old images (if present)..."
docker rmi 1995rtc/trabelci-admin:latest || true
docker rmi 1995rtc/trabelci-backend:latest || true

echo "Pulling latest images from Docker Hub..."
docker pull 1995rtc/trabelci-admin:latest
docker pull 1995rtc/trabelci-backend:latest

echo "Starting backend container..."
docker run -d \
  --name backend-service \
  -p 5001:5001 \
  -v /opt/backend-apk:/app/public/apk \
  --restart unless-stopped \
  1995rtc/trabelci-backend:latest

echo "Starting admin panel container..."
docker run -d \
  --name admin-panel \
  -p 5173:80 \
  --restart unless-stopped \
  1995rtc/trabelci-admin:latest

echo "Tailing admin panel logs (Ctrl+C to stop watching)..."
docker logs -f admin-panel
