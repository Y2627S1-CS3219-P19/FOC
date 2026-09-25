# Build context is the repo root (see compose.yaml) so the shared packages can be included.
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
COPY user-service user-service
RUN npm run build -w @foc/shared-middleware -w @foc/shared-events -w user-service \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/user-service/package.json user-service/package.json
COPY --from=build /app/user-service/dist user-service/dist
COPY --from=build /app/user-service/migrations user-service/migrations
COPY --from=build /app/user-service/openapi.yaml user-service/openapi.yaml
USER node
EXPOSE 3001
CMD ["node", "user-service/dist/index.js"]
