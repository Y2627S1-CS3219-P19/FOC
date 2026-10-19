# API gateway: the single public entry point. Routes /v1/* to the services and everything else to the web app.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
