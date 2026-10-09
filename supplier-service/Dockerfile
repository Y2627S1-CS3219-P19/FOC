# Build stage
FROM node:22-alpine AS builder
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
COPY supplier-service supplier-service
RUN npm run build -w @foc/shared-middleware -w supplier-service \
 && npm prune --omit=dev --no-audit --no-fund

# Production runtime stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/
COPY openapi.yaml ./

EXPOSE 3002
CMD ["node", "dist/index.js"]


