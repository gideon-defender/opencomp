-- The trigger shim creates/updates its own run and token tables at startup.
-- Keep that DDL capability in a dedicated schema, separate from tenant data.
-- LOCAL_TRIGGER_DATABASE_URL must set options=-c search_path=opencomp_trigger,public.
CREATE SCHEMA IF NOT EXISTS opencomp_trigger;
REVOKE ALL ON SCHEMA opencomp_trigger FROM PUBLIC, comp_app;
GRANT USAGE, CREATE ON SCHEMA opencomp_trigger TO comp_service;
COMMENT ON SCHEMA opencomp_trigger IS 'Internal local-trigger run and token persistence; runtime role only';
