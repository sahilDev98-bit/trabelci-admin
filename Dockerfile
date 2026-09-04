# Pinned by digest, not the mutable `:alpine` tags, so a rebuild next month
# can't silently pull in a different base image than the one this was
# actually tested against (forensic audit F-33). Re-resolve with:
#   curl -s -H "Authorization: Bearer $(curl -s 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/<image>:pull' | python -c "import json,sys;print(json.load(sys.stdin)['token'])")" \
#     -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json" -H "Accept: application/vnd.oci.image.index.v1+json" \
#     -I https://registry-1.docker.io/v2/library/<image>/manifests/<tag> | grep -i docker-content-digest
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_ADMIN_API_BASE_URL
ARG VITE_ROOM_VISUALIZER_URL
ARG VITE_EXTRACT_PDF_URL

# `npm run build` does `cp .env .env.local` before building (see
# package.json) — until now that .env was whatever real, uncommitted file
# happened to be sitting in this directory on the machine running
# `docker build`, swept up by `COPY . .` above. Excluding .env* via
# .dockerignore (forensic audit F-33 — don't let secrets end up in an image
# layer) broke that, since there was nothing left for `cp` to copy. Writing
# it here from the ARGs instead means the real values still flow through
# (build.sh now reads the local .env and passes these as --build-arg), but
# the .env file itself, and everything else that was in it, never enters
# the build context or any layer at all.
RUN { \
    echo "VITE_SUPABASE_URL=${VITE_SUPABASE_URL}"; \
    echo "VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}"; \
    echo "VITE_ADMIN_API_BASE_URL=${VITE_ADMIN_API_BASE_URL}"; \
    echo "VITE_ROOM_VISUALIZER_URL=${VITE_ROOM_VISUALIZER_URL}"; \
    echo "VITE_EXTRACT_PDF_URL=${VITE_EXTRACT_PDF_URL}"; \
    } > .env

RUN npm run build

# Not switched to a non-root USER here (forensic audit F-33's other ask):
# nginx's own master process needs root to bind port 80, and unlike the
# Node API image, nginx already drops privilege on its own for the code
# that actually parses client requests — worker processes run as the
# unprivileged `nginx` user by default via nginx.conf's own `user`
# directive, root is only ever the master process managing them. Moving to
# a fully unprivileged container would mean listening on a port >=1024
# instead, which means also updating deploy.sh's port mapping and the
# host-level nginx reverse proxy config — a coordinated infra change, not
# a Dockerfile-only one, so left as a deliberate follow-up rather than
# risking the current working setup on a guess.
FROM nginx:alpine@sha256:72ba65eb42c10344912a84ff42408db7d34f2feb642204570ab8fc5ffd29f1d3

COPY nginx.conf /etc/nginx/conf.d/default.conf
# NOT under conf.d/ — the base image's own nginx.conf globs
# /etc/nginx/conf.d/*.conf directly into the http block, so a file there
# would load twice: once via that glob (as bare, unscoped add_header
# directives) and once via the explicit `include` in each location block.
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
