FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_ADMIN_API_BASE_URL
ARG VITE_ROOM_VISUALIZER_URL
ARG VITE_EXTRACT_PDF_URL

RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
# NOT under conf.d/ — the base image's own nginx.conf globs
# /etc/nginx/conf.d/*.conf directly into the http block, so a file there
# would load twice: once via that glob (as bare, unscoped add_header
# directives) and once via the explicit `include` in each location block.
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
