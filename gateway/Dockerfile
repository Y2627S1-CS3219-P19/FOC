# API gateway: the single public entry point. Routes /v1/* to the services and everything else to the web app.
FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
# Pick up Alpine security fixes released after the base image was built (Trivy gate in pr.yml).
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
