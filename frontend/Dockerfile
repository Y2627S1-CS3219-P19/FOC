# Build context is the repo root (see compose.yaml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-middleware/package.json packages/shared-middleware/
COPY packages/shared-events/package.json packages/shared-events/
COPY user-service/package.json user-service/
COPY supplier-service/package.json supplier-service/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY frontend frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
