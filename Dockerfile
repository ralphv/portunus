FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Baked into the bundle at build time so the UI footer always matches
# the image tag (CI passes the release version; default falls back to
# package.json via NEXT_PUBLIC_APP_VERSION=undefined-ish empty).
ARG APP_VERSION=
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Docker sets HOSTNAME to the container id; pin the standalone server to the
# wildcard so it binds predictably and internal URLs aren't built from the id.
ENV HOSTNAME="0.0.0.0"
ARG APP_VERSION=
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
RUN addgroup -S portunus && adduser -S portunus -G portunus
COPY --from=builder /app/public ./public
COPY --from=builder --chown=portunus:portunus /app/.next/standalone ./
COPY --from=builder --chown=portunus:portunus /app/.next/static ./.next/static
USER portunus
EXPOSE 3000
CMD ["node", "server.js"]
