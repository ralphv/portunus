FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S portunus && adduser -S portunus -G portunus
COPY --from=builder /app/public ./public
COPY --from=builder --chown=portunus:portunus /app/.next/standalone ./
COPY --from=builder --chown=portunus:portunus /app/.next/static ./.next/static
USER portunus
EXPOSE 3000
CMD ["node", "server.js"]
