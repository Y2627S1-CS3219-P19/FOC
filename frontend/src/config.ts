export const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080';
export const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM ?? 'campuserrand';
export const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'campuserrand-spa';
/** Dev inbox that catches every email Keycloak sends. */
export const MAILPIT_URL = import.meta.env.VITE_MAILPIT_URL ?? 'http://localhost:8025';
export const ACCOUNT_CONSOLE_URL = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account`;
