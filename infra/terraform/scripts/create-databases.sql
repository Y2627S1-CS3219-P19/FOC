-- One Postgres instance, six logical databases, one user per database (aws-infra-plan.txt DATA).
-- Run by admin-task.sh as the RDS master user. Passwords come in as psql variables (:'users_pw' ...).
-- Idempotent: creates what is missing and re-sets the passwords.
--
-- Each service user OWNS its database (so its migrations can create tables) and nobody else may even
-- connect to it: the "no cross-service database access" rule, enforced by Postgres itself.

-- 1. Users
SELECT format('CREATE ROLE %I LOGIN', r)
FROM (VALUES ('users'), ('suppliers'), ('credits'), ('orders'), ('faq'), ('keycloak')) AS v(r)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE users     PASSWORD :'users_pw';
ALTER ROLE suppliers PASSWORD :'suppliers_pw';
ALTER ROLE credits   PASSWORD :'credits_pw';
ALTER ROLE orders    PASSWORD :'orders_pw';
ALTER ROLE faq       PASSWORD :'faq_pw';
ALTER ROLE keycloak  PASSWORD :'keycloak_pw';

-- 2. Postgres 16: to create a database OWNED BY another role you must be a member of that role.
GRANT users, suppliers, credits, orders, faq, keycloak TO CURRENT_USER;

-- 3. Databases
SELECT format('CREATE DATABASE %I OWNER %I', d, r)
FROM (VALUES ('users_db', 'users'), ('suppliers_db', 'suppliers'), ('credits_db', 'credits'),
             ('orders_db', 'orders'), ('faq_db', 'faq'), ('keycloak', 'keycloak')) AS v(d, r)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = d)
\gexec

-- 4. By default every user may connect to every database. Take that away; owners keep their access.
REVOKE CONNECT, TEMPORARY ON DATABASE users_db, suppliers_db, credits_db, orders_db, faq_db, keycloak FROM PUBLIC;

SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname NOT LIKE 'template%' ORDER BY 1;
