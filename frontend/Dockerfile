# Build context is the repo root (see compose.yaml).
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-middleware/package.json packages/shared-middleware/
COPY packages/shared-events/package.json packages/shared-events/
COPY user-service/package.json user-service/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY frontend frontend
# Vite reads VITE_* from the environment at build time.
ARG VITE_KEYCLOAK_URL
ARG VITE_MAILPIT_URL
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL VITE_MAILPIT_URL=$VITE_MAILPIT_URL
RUN npm run build -w frontend

FROM nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
