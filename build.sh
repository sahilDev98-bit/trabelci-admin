docker build -t 1995rtc/trabelci-admin:latest .
docker push 1995rtc/trabelci-admin:latest

# "build": "node -e \"require('fs').copyFileSync('.env', '.env.local')\" && tsc -b && vite build",
