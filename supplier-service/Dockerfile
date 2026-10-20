# Build context is the repo root (see compose.yaml) so the image can include data/.
# Build stage
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder
WORKDIR /app

COPY supplier-service/package*.json ./
RUN npm ci

COPY supplier-service/tsconfig.json ./
COPY supplier-service/src/ ./src/
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# Production runtime stage
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
WORKDIR /app

ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY supplier-service/migrations/ ./migrations/
COPY supplier-service/openapi.yaml ./
# Seed CSV and supplier photos (SEED_CSV_PATH / IMAGES_DIR point here). Fargate has no bind mounts.
COPY data/csv/ ./data/csv/
COPY data/images/ ./data/images/

EXPOSE 3002
CMD ["node", "dist/index.js"]
