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

FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
# Pick up Alpine security fixes released after the base image was built (Trivy gate in pr.yml).
RUN apk upgrade --no-cache
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
