FROM node:24-bookworm@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4 AS builder
WORKDIR /build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec tsc -p tsconfig.docker.json && pnpm run build:web

FROM node:24-bookworm@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4 AS prod-deps
WORKDIR /build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS runtime
ENV NODE_ENV=production \
    PORT=48730 \
    WEB_DIST_DIR=dist/web
WORKDIR /app
COPY --from=prod-deps /build/node_modules ./node_modules
COPY --from=builder /build/dist/server/ ./
COPY --from=builder /build/dist/web ./dist/web
COPY --from=builder /build/drizzle ./drizzle
COPY package.json docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 48730
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||48730)+'/api/health/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
