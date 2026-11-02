# Realm and theme are baked in because Fargate has no bind mounts. Per-environment values come from env:
# ${KC_*} placeholders in the realm are filled on first import.
# Plain `start` (not --optimized) so one image works both locally and on AWS (/auth path set at runtime).
FROM quay.io/keycloak/keycloak:26.8.1@sha256:3f3c5f8e03c614774b4bd9173b88391fefa4153bfc010d8012d59ad825377332
COPY campuserrand-realm.json /opt/keycloak/data/import/campuserrand-realm.json
COPY themes/tapau /opt/keycloak/themes/tapau
CMD ["start", "--import-realm"]
