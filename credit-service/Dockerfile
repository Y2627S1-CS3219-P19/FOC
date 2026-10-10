# Build context is the repo root (see compose.yaml) so the shared packages can be included.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-middleware/package.json packages/shared-middleware/
COPY packages/shared-events/package.json packages/shared-events/
COPY user-service/package.json user-service/
COPY credit-service/package.json credit-service/
COPY order-service/package.json order-service/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY credit-service credit-service
RUN npm run build -w @foc/shared-middleware -w @foc/shared-events -w credit-service \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/credit-service/package.json credit-service/package.json
COPY --from=build /app/credit-service/dist credit-service/dist
COPY --from=build /app/credit-service/migrations credit-service/migrations
COPY --from=build /app/credit-service/openapi.yaml credit-service/openapi.yaml
USER node
EXPOSE 3003
CMD ["node", "credit-service/dist/index.js"]