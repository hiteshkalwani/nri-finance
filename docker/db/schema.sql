-- Runs once, when the supabase/postgres image initialises an empty volume (it executes /etc/postgresql.schema.sql).
-- Same as the Supabase CLI: the login roles our services use get the generated local password.
\set pgpass `echo "$PGPASSWORD"`
ALTER USER postgres WITH PASSWORD :'pgpass';
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
