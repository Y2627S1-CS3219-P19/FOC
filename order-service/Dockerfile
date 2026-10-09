# Build context is the repo root (see compose.yaml) so the shared packages can be included.
# Same pattern as credit-service/Dockerfile.
FROM node:22.16.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-middleware/package.json packages/shared-middleware/
COPY packages/shared-events/package.json packages/shared-events/
COPY user-service/package.json user-service/
COPY supplier-service/package.json supplier-service/
COPY credit-service/package.json credit-service/
COPY order-service/package.json order-service/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY order-service order-service
RUN npm run build -w @foc/shared-middleware -w @foc/shared-events -w order-service \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22.16.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/order-service/package.json order-service/package.json
COPY --from=build /app/order-service/dist order-service/dist
COPY --from=build /app/order-service/migrations order-service/migrations
USER node
EXPOSE 3004
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3004/health/ready || exit 1
CMD ["node", "order-service/dist/index.js"]
