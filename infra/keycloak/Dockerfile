# Realm and theme are baked in because Fargate has no bind mounts. Per-environment values come from env:
# ${KC_*} placeholders in the realm are filled on first import.
# Plain `start` (not --optimized) so one image works both locally and on AWS (/auth path set at runtime).
FROM quay.io/keycloak/keycloak:26.7.4@sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c
COPY campuserrand-realm.json /opt/keycloak/data/import/campuserrand-realm.json
COPY themes/tapau /opt/keycloak/themes/tapau
CMD ["start", "--import-realm"]
