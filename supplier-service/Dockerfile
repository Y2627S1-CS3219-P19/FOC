# Build context is the repo root (see compose.yaml) so the shared packages and seed data can be included.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-middleware/package.json packages/shared-middleware/
COPY packages/shared-events/package.json packages/shared-events/
COPY user-service/package.json user-service/
COPY supplier-service/package.json supplier-service/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY supplier-service supplier-service
RUN npm run build -w @foc/shared-middleware -w supplier-service \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/supplier-service/package.json supplier-service/package.json
COPY --from=build /app/supplier-service/dist supplier-service/dist
COPY --from=build /app/supplier-service/migrations supplier-service/migrations
COPY --from=build /app/supplier-service/openapi.yaml supplier-service/openapi.yaml
COPY data data
USER node
EXPOSE 3002
CMD ["node", "supplier-service/dist/index.js"]
